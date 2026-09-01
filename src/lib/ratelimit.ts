/**
 * Per-IP rate limit for the endpoints that spend money (LLM calls) or write missions. Fixed 60 s
 * window: INCR + EXPIRE on the same Upstash Redis the missions live in (raw REST, like repo.ts);
 * in-process Map when Redis is not configured. Reads are never limited.
 *
 * Budgets are ≥ 3× what one built-in-agent run needs (a Send is ≤ 24 model steps; a full mission is
 * ~20–30 actions in ~30 s). A per-minute ceiling does not stop a patient caller, so `dailyBudget`
 * adds a per-day ceiling on the two buckets that spend the OpenAI key — the built-in agent's model
 * steps, and the plan/search/explain actions — counted both per address and across everyone.
 * Kill switch: RATE_LIMIT=off.
 */

export type Bucket = "agent" | "actions" | "missions";

const LIMITS: Record<Bucket, number> = {
  agent: Number(process.env.RATE_LIMIT_AGENT ?? 60), // LLM steps per minute per IP
  actions: Number(process.env.RATE_LIMIT_ACTIONS ?? 150), // mission mutations per minute per IP
  missions: Number(process.env.RATE_LIMIT_MISSIONS ?? 20), // new missions per minute per IP
};
const WINDOW_S = 60;
const DAY_TTL_S = 172800;

/**
 * Per-day ceilings for the buckets that spend the OpenAI key, across everyone (`all`) and per
 * address (`perIp`). `perIp` is what stops one caller draining the day's budget in a few minutes;
 * it is sized at roughly ten full missions, `all` at roughly eighty. A bucket absent here — or a
 * limit of 0 — has no daily ceiling. Sizing note: a full mission is ~10 agent steps and ~10
 * LLM-spending actions.
 */
const DAY_LIMITS: Partial<Record<Bucket, { all: number; perIp: number }>> = {
  agent: { all: Number(process.env.RATE_LIMIT_AGENT_DAY ?? 800), perIp: Number(process.env.RATE_LIMIT_AGENT_IP_DAY ?? 120) },
  actions: { all: Number(process.env.RATE_LIMIT_ACTIONS_DAY ?? 800), perIp: Number(process.env.RATE_LIMIT_ACTIONS_IP_DAY ?? 120) },
};

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = new Map<string, { n: number; resetAt: number }>();

export function clientIp(req: Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip") ?? "local").trim();
}

async function count(key: string, ttlS = WINDOW_S): Promise<{ n: number; ttl: number }> {
  if (url && token) {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, ttlS, "NX"], ["TTL", key]]),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ratelimit redis ${res.status}`);
    const [incr, , ttl] = (await res.json()) as { result: number }[];
    return { n: incr.result, ttl: ttl.result };
  }
  const now = Date.now();
  const cur = memory.get(key);
  if (!cur || cur.resetAt <= now) {
    memory.set(key, { n: 1, resetAt: now + ttlS * 1000 });
    return { n: 1, ttl: ttlS };
  }
  cur.n++;
  return { n: cur.n, ttl: Math.ceil((cur.resetAt - now) / 1000) };
}

/** Returns null when allowed, or a 429 Response to return as-is. Fails open if Redis errors. */
export async function rateLimit(req: Request, bucket: Bucket): Promise<Response | null> {
  if (process.env.RATE_LIMIT === "off") return null;
  const limit = LIMITS[bucket];
  const ip = clientIp(req);
  const window = Math.floor(Date.now() / 1000 / WINDOW_S);
  try {
    const { n, ttl } = await count(`rl:${bucket}:${ip}:${window}`);
    if (n <= limit) return null;
    const retry = Math.max(1, ttl);
    return Response.json(
      { error: `rate limited: more than ${limit} ${bucket} requests per minute from this address; retry in ${retry} s` },
      { status: 429, headers: { "retry-after": String(retry), "x-ratelimit-limit": String(limit), "x-ratelimit-remaining": "0" } },
    );
  } catch (e) {
    console.warn("[ratelimit] failing open:", e);
    return null;
  }
}

/**
 * Daily ceiling on the work that spends our OpenAI key. Returns null when allowed, or a 429 to
 * return as-is; fails open if Redis errors.
 *
 * Note this covers BOTH routes that spend: an agent driving the board from ChatGPT pays for its own
 * conversation, but the planning, re-ranking and tradeoff calls behind plan/search/explain run on
 * our key regardless of who is driving. Callers gate only those actions — never a human's board
 * edit, which costs nothing.
 *
 * The per-address ceiling is checked first, so a caller who has hit their own limit stops consuming
 * what is left for everyone else.
 */
export async function dailyBudget(req: Request, bucket: Bucket): Promise<Response | null> {
  if (process.env.RATE_LIMIT === "off") return null;
  const limits = DAY_LIMITS[bucket];
  if (!limits) return null;
  const day = new Date().toISOString().slice(0, 10);
  const over = (scope: string, limit: number) =>
    Response.json(
      { error: `daily budget spent: more than ${limit} ${bucket} requests today ${scope}. It resets at 00:00 UTC.` },
      { status: 429, headers: { "x-ratelimit-limit": String(limit), "x-ratelimit-remaining": "0" } },
    );
  try {
    if (Number.isFinite(limits.perIp) && limits.perIp > 0) {
      const { n } = await count(`rl:${bucket}:day:${day}:${clientIp(req)}`, DAY_TTL_S);
      if (n > limits.perIp) return over("from this address", limits.perIp);
    }
    if (Number.isFinite(limits.all) && limits.all > 0) {
      const { n } = await count(`rl:${bucket}:day:${day}`, DAY_TTL_S);
      if (n > limits.all) return over("across all callers", limits.all);
    }
    return null;
  } catch (e) {
    console.warn("[ratelimit] daily budget failing open:", e);
    return null;
  }
}
