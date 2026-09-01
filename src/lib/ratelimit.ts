/**
 * Per-IP rate limit for the endpoints that spend money (LLM calls) or write missions. Fixed 60 s
 * window: INCR + EXPIRE on the same Upstash Redis the missions live in (raw REST, like repo.ts);
 * in-process Map when Redis is not configured. Reads are never limited.
 *
 * Budgets are ≥ 3× what one built-in-agent run needs (a Send is ≤ 24 model steps; a full mission is
 * ~20–30 actions in ~30 s). Per-IP limits do not stop a patient or distributed abuser spending the
 * OpenAI key, so `globalBudget` caps agent steps per day across everyone. Kill switch: RATE_LIMIT=off.
 */

export type Bucket = "agent" | "actions" | "missions";

const LIMITS: Record<Bucket, number> = {
  agent: Number(process.env.RATE_LIMIT_AGENT ?? 60), // LLM steps per minute per IP
  actions: Number(process.env.RATE_LIMIT_ACTIONS ?? 150), // mission mutations per minute per IP
  missions: Number(process.env.RATE_LIMIT_MISSIONS ?? 20), // new missions per minute per IP
};
const WINDOW_S = 60;
/** Agent steps per day across all callers; the demo keeps working through WebMCP when it trips. */
const DAY_LIMIT = Number(process.env.RATE_LIMIT_AGENT_DAY ?? 3000);
const DAY_TTL_S = 172800;

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
 * Daily ceiling on model steps for the whole deployment, so a determined caller cannot run up the
 * OpenAI bill one address at a time. Returns null when allowed, or a 429 to return as-is. The page's
 * WebMCP tools are unaffected — an agent driving the board from ChatGPT spends its own tokens.
 */
export async function globalBudget(bucket: Bucket = "agent"): Promise<Response | null> {
  if (process.env.RATE_LIMIT === "off") return null;
  if (!Number.isFinite(DAY_LIMIT) || DAY_LIMIT <= 0) return null;
  const day = new Date().toISOString().slice(0, 10);
  try {
    const { n } = await count(`rl:${bucket}:day:${day}`, DAY_TTL_S);
    if (n <= DAY_LIMIT) return null;
    return Response.json(
      { error: "The built-in agent's daily budget for this demo is spent (resets 00:00 UTC). The board's WebMCP tools still work — drive it from ChatGPT or Chrome." },
      { status: 429, headers: { "x-ratelimit-limit": String(DAY_LIMIT), "x-ratelimit-remaining": "0" } },
    );
  } catch (e) {
    console.warn("[ratelimit] daily budget failing open:", e);
    return null;
  }
}
