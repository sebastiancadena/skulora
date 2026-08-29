/**
 * Mission persistence. Upstash Redis (REST) when configured — the Vercel "Upstash for Redis"
 * integration injects KV_REST_API_URL / KV_REST_API_TOKEN — otherwise an in-process Map, which is
 * fine for local dev and survives within one warm serverless instance only.
 */
import type { Mission } from "./types";

const TTL_SECONDS = 60 * 60 * 24 * 45; // keep missions through the judging window

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

const memory = new Map<string, Mission>();
let warned = false;

function key(id: string) {
  return `mission:${id}`;
}

export function repoKind() {
  return url && token ? "upstash" : "memory";
}

export async function getMission(id: string): Promise<Mission | null> {
  if (url && token) {
    const res = await fetch(`${url}/get/${encodeURIComponent(key(id))}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`kv get failed: ${res.status}`);
    const { result } = (await res.json()) as { result: string | null };
    return result ? (JSON.parse(result) as Mission) : null;
  }
  if (!warned) {
    warned = true;
    console.warn("[repo] KV not configured — using in-memory missions (not durable across instances)");
  }
  return memory.get(id) ?? null;
}

/** Create a brand-new mission (version must be 1; fails if the id already exists). */
export async function putMission(m: Mission): Promise<void> {
  if (!(await putIfVersion(m, 0))) throw new Error(`mission ${m.id} already exists`);
}

// Compare-and-set: write only if the stored version is still `expected`. Agents call tools in
// parallel (ChatGPT fired eight search_products at once), so last-write-wins loses candidates.
const CAS_SCRIPT = `
local v = redis.call('GET', KEYS[2])
if v == false then
  -- no version key: either a brand-new mission (expected 0) or one written before versioning existed
  if ARGV[1] ~= '0' and redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
  if ARGV[1] == '0' and redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
elseif v ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
return 1`;

async function putIfVersion(m: Mission, expected: number): Promise<boolean> {
  m.updated_at = new Date().toISOString();
  if (url && token) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(["EVAL", CAS_SCRIPT, 2, key(m.id), `${key(m.id)}:v`, String(expected), JSON.stringify(m), String(m.version), String(TTL_SECONDS)]),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`kv cas failed: ${res.status}`);
    const { result } = (await res.json()) as { result: number };
    return result === 1;
  }
  const cur = memory.get(m.id);
  if ((cur?.version ?? 0) !== expected) return false;
  memory.set(m.id, m);
  return true;
}

/**
 * Read → mutate → bump version → compare-and-set, retried on conflict. Keep `fn` cheap and pure
 * (no network): do LLM calls and merchant searches before calling this and apply their results here.
 */
export async function mutateMission(id: string, fn: (m: Mission) => void | Promise<void>): Promise<Mission> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const m = await getMission(id);
    if (!m) throw new NotFound(id);
    const expected = m.version;
    await fn(m);
    m.version = expected + 1;
    if (await putIfVersion(m, expected)) return m;
    await new Promise((r) => setTimeout(r, 25 + Math.random() * 75));
  }
  throw new Error("mission is being updated concurrently; retry");
}

export class NotFound extends Error {
  constructor(id: string) {
    super(`mission ${id} not found`);
  }
}
