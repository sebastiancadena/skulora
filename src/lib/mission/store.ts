/**
 * Client-side mission state (Day-0 placeholder; moves server-side with SSE on Day 2).
 * Human edits and agent tool calls both go through `update()`, and every change is appended to
 * `events` so that tool results can report a `mission_delta` — what the human changed since the
 * agent's last call.
 */
import { useSyncExternalStore } from "react";

export type MissionEvent = { seq: number; at: string; actor: "human" | "agent"; type: string; detail?: unknown };

export interface Mission {
  id: string;
  goal: string;
  budget_total_cents?: number;
  currency: string;
  owned_items: string[];
  constraints: string[];
  slots: Slot[];
  events: MissionEvent[];
}

export interface Slot {
  id: string;
  need: string;
  constraints: string[];
  candidates: unknown[];
  selected?: string;
  locked?: boolean;
  rejected: string[];
}

const KEY = "skulora.mission.v1";
let mission: Mission | null = null;
const listeners = new Set<() => void>();
let seq = 0;
let hydrated = false;

/** Load the last mission from localStorage (client only). Idempotent. */
export function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      mission = JSON.parse(raw) as Mission;
      seq = mission.events.at(-1)?.seq ?? 0;
    }
  } catch {
    /* corrupt or unavailable storage: start empty */
  }
}

function persist() {
  try {
    if (typeof window === "undefined") return;
    if (mission) window.localStorage.setItem(KEY, JSON.stringify(mission));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function getMission() {
  hydrate();
  return mission;
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(actor: MissionEvent["actor"], type: string, mutate: (m: Mission | null) => Mission | null, detail?: unknown) {
  hydrate();
  mission = mutate(mission);
  if (mission) mission.events.push({ seq: ++seq, at: new Date().toISOString(), actor, type, detail });
  persist();
  listeners.forEach((fn) => fn());
  return mission;
}

/** Events after `sinceSeq` that were made by the human — the agent's view of what changed. */
export function delta(sinceSeq: number) {
  return (mission?.events ?? []).filter((e) => e.seq > sinceSeq && e.actor === "human");
}

export function useMission() {
  return useSyncExternalStore(subscribe, getMission, () => null);
}

export function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}
