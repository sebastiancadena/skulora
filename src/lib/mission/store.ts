/**
 * Browser-side mission client. The server owns the mission; this module keeps the current mission
 * id (localStorage), a cached copy, and a 2 s poll while the tab is visible so human edits and
 * agent tool calls converge on one board. Both the board UI and the WebMCP tools go through `act()`.
 */
import { useSyncExternalStore } from "react";
import { missionTotals, type Actor, type Mission, type MissionEvent } from "./types";

const ID_KEY = "skulora.missionId";
let mission: Mission | null = null;
let missionId: string | null = null;
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

export function currentMission() {
  return mission;
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useMission() {
  return useSyncExternalStore(subscribe, currentMission, () => null);
}

export function boot() {
  if (typeof window === "undefined" || pollTimer) return;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("m");
    missionId = fromUrl ?? window.localStorage.getItem(ID_KEY);
    if (fromUrl) window.localStorage.setItem(ID_KEY, fromUrl);
  } catch {
    /* storage unavailable */
  }
  void refresh();
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible" && missionId) void refresh();
  }, 2000);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function refresh() {
  if (!missionId) return null;
  try {
    const { mission: m } = await api<{ mission: Mission }>(`/api/missions/${missionId}`);
    if (!mission || m.version !== mission.version) {
      mission = m;
      emit();
    }
  } catch {
    /* transient; next poll retries */
  }
  return mission;
}

export async function createMission(input: { goal: string; budget_total_cents?: number; currency?: string; owned_items?: string[]; constraints?: string[] }) {
  const { mission: m } = await api<{ mission: Mission }>("/api/missions", { method: "POST", body: JSON.stringify(input) });
  mission = m;
  missionId = m.id;
  try {
    window.localStorage.setItem(ID_KEY, m.id);
  } catch {
    /* ignore */
  }
  emit();
  return m;
}

/** Forget the current mission on this browser (the server keeps it; ?m=<id> reopens it). */
export function clearMission() {
  mission = null;
  missionId = null;
  try {
    window.localStorage.removeItem(ID_KEY);
    window.history.replaceState(null, "", window.location.pathname);
  } catch {
    /* ignore */
  }
  emit();
}

export type ActionResult = { mission: Mission; totals: ReturnType<typeof missionTotals>; [k: string]: unknown };

/** Perform a mutation. Human actions send the version they saw so stale clicks are flagged. */
export async function act(actor: Actor, type: string, fields: Record<string, unknown> = {}): Promise<ActionResult> {
  if (!missionId) throw new Error("no mission yet — call create_mission first");
  const r = await api<ActionResult>(`/api/missions/${missionId}/actions`, {
    method: "POST",
    body: JSON.stringify({ actor, type, version: actor === "human" ? mission?.version : undefined, ...fields }),
  });
  mission = r.mission;
  emit();
  return r;
}

/** Human events after `sinceSeq` — what the agent has not yet seen. */
export function humanEventsSince(sinceSeq: number): MissionEvent[] {
  return (mission?.events ?? []).filter((e) => e.seq > sinceSeq && e.actor === "human");
}

export { missionTotals };
