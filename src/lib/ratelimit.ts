/**
 * Per-IP rate limit for the endpoints that spend money (LLM calls) or write missions. Fixed 60 s
 * window: INCR + EXPIRE on the same Upstash Redis the missions live in (raw REST, like repo.ts);
 * in-process Map when Redis is not configured. Reads are never limited.
 *
 * Budgets are ≥ 3× what one built-in-agent run needs (a Send is ≤ 24 model steps; a full mission is
 * ~20–30 actions in ~30 s). Kill switch: RATE_LIMIT=off.
 */

export type Bucket = "agent" | "actions" | "missions";

const LIMITS: Record<Bucket, number> = {
  agent: Number(process.env.RATE_LIMIT_AGENT ?? 60), // LLM steps per minute per IP
  actions: Number(process.env.RATE_LIMIT_ACTIONS ?? 150), // mission mutations per minute per IP
  missions: Number(process.env.RATE_LIMIT_MISSIONS ?? 20), // new missions per minute per IP
};
const WINDOW_S = 60;

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = new Map<string, { n: number; resetAt: number }>();

export function clientIp(req: Request) {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip") ?? "local").trim();
}

async function count(key: string): Promise<{ n: number; ttl: number }> {
  if (url && token) {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, WINDOW_S, "NX"], ["TTL", key]]),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ratelimit redis ${res.status}`);
    const [incr, , ttl] = (await res.json()) as { result: number }[];
    return { n: incr.result, ttl: ttl.result };
  }
  const now = Date.now();
  const cur = memory.get(key);
  if (!cur || cur.resetAt <= now) {
    memory.set(key, { n: 1, resetAt: now + WINDOW_S * 1000 });
    return { n: 1, ttl: WINDOW_S };
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
