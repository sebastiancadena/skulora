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

export async function putMission(m: Mission): Promise<void> {
  m.updated_at = new Date().toISOString();
  if (url && token) {
    const res = await fetch(`${url}/set/${encodeURIComponent(key(m.id))}?EX=${TTL_SECONDS}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(m),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`kv set failed: ${res.status}`);
    return;
  }
  memory.set(m.id, m);
}

/** Apply a mutation atomically enough for a demo: read → mutate → bump version → write. */
export async function mutateMission(id: string, fn: (m: Mission) => void | Promise<void>): Promise<Mission> {
  const m = await getMission(id);
  if (!m) throw new NotFound(id);
  await fn(m);
  m.version += 1;
  await putMission(m);
  return m;
}

export class NotFound extends Error {
  constructor(id: string) {
    super(`mission ${id} not found`);
  }
}
