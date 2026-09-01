/**
 * The Skulora tool table — one source of truth for the browser's WebMCP surface and the built-in
 * agent. Metadata lives in `specs.ts` (no browser imports, so the server can read it too); this
 * module pairs each spec with the executor that runs in the page. Tools are grouped in stages that
 * are registered progressively as the mission advances (PRD §6). Every result carries
 * `mission_delta`: the person's edits since this agent's last call.
 */
import type { ToolDefinition } from "./types";
import { specs, type Stage } from "./specs";
import { act, createMission, currentMission, humanEventsSince, missionTotals, notify, refresh } from "../mission/store";
import type { Candidate, Mission, Slot } from "../mission/types";

export type { Stage };
/** Last event seq the agent was told about, per mission: a cursor from one board must not hide or replay another board's edits. */
const cursors = new Map<string, number>();
export const AGENT_DEFAULT = "webmcp";

/** Human edits the agent has not been told about yet (the next tool result will carry them as mission_delta). */
export function pendingHumanEdits() {
  const id = currentMission()?.id;
  return id ? humanEventsSince(cursors.get(id) ?? 0) : [];
}

function money(cents: number | undefined, cur = "USD") {
  return cents == null ? null : `${(cents / 100).toFixed(2)} ${cur}`;
}

function compactCandidate(c: Candidate) {
  return { id: c.id, title: c.title.slice(0, 80), merchant: c.merchant_domain, price: money(c.price_cents, c.currency), why: c.why_it_fits, caveats: c.caveats };
}

function compactSlot(s: Slot) {
  const sel = s.candidates.find((c) => c.id === s.selected);
  return {
    id: s.id,
    need: s.need,
    required: s.required,
    constraints: s.constraints,
    budget_hint: money(s.budget_hint_cents),
    selected: sel ? compactCandidate(sel) : null,
    locked: s.locked,
    rejected: s.rejected.map((r) => ({ candidate_id: r.candidate_id, reason: r.reason ?? null })),
    candidates: s.candidates.length,
  };
}

function compact(m: Mission | null) {
  if (!m) return null;
  const t = missionTotals(m);
  return {
    id: m.id,
    goal: m.goal,
    budget: money(m.budget_total_cents, m.currency),
    selected_total: money(t.selected_cents, m.currency),
    remaining: money(t.remaining_cents ?? undefined, m.currency),
    over_budget: t.over_budget,
    owned_items: m.owned_items,
    constraints: m.constraints,
    slots: m.slots.map(compactSlot),
    required_unfilled: t.required_unfilled,
    merchants: t.merchants,
    checkouts: Object.values(m.carts).map((c) => ({ merchant: c.merchant_domain, total: money(c.total_cents, c.currency), ready: !!c.checkout_url, error: c.error ?? null })),
  };
}

const ORDER: Stage[] = ["A", "B", "C"];
/** Highest stage each mission has reached. */
const reached = new Map<string, Stage>();

/**
 * Disclosure stage. It advances as the mission does and, within one mission, never goes back: a
 * person rejecting the pick in a required slot at Stage C must not unregister the checkout tools
 * under a call in flight (Chrome then fails the call although it ran) or churn `toolchange`. The
 * server refuses prepare_checkout while a required slot is empty, so keeping the tools is safe.
 */
export function stageFor(m: Mission | null): Stage {
  if (!m) return "A";
  const t = missionTotals(m);
  const now: Stage = m.slots.length > 0 && t.required_unfilled.length === 0 ? "C" : "B";
  const best = reached.get(m.id);
  const stage = best && ORDER.indexOf(best) > ORDER.indexOf(now) ? best : now;
  reached.set(m.id, stage);
  return stage;
}

function withDelta(_agent: string, body: Record<string, unknown>) {
  const m = currentMission();
  const since = m ? (cursors.get(m.id) ?? 0) : 0;
  if (m) cursors.set(m.id, m.events.at(-1)?.seq ?? 0);
  notify();
  const delta = m ? humanEventsSince(since).map((e) => ({ type: e.type, detail: e.detail })) : [];
  const stage = stageFor(m);
  // What to do next follows the board's actual state, not the disclosure stage: at Stage C with a
  // required slot emptied again, the way forward is choose_candidate, not prepare_checkout.
  const ready = !!m && m.slots.length > 0 && missionTotals(m).required_unfilled.length === 0;
  const next = !m ? ["create_mission"] : ready ? ["prepare_checkout", "get_checkout_status"] : ["plan_kit", "search_products", "choose_candidate", "explain_tradeoffs"];
  return { ...body, mission_delta: delta, stage, next_suggested_tools: next };
}

function err(agent: string, message: string) {
  return withDelta(agent, { error: message });
}

/** A board with picks on it is work the person may be relying on; replacing it needs an explicit `replace: true`. */
function inProgress(m: Mission | null) {
  return !!m && m.slots.some((s) => s.selected || s.locked);
}
/** What each tool does when called in the page. Keyed by the names in `specs`. */
const executors: Record<string, ToolDefinition["execute"]> = {
  get_mission: async () => {
    await refresh();
    return withDelta(AGENT_DEFAULT, { mission: compact(currentMission()) });
  },
  create_mission: async (args) => {
    const { replace, ...input } = args as { goal: string; replace?: boolean };
    const cur = currentMission();
    if (inProgress(cur) && replace !== true) {
      const picks = cur!.slots.filter((s) => s.selected).length;
      return err(AGENT_DEFAULT, `a mission is already in progress on this board ("${cur!.goal}", ${picks} pick${picks === 1 ? "" : "s"}). Use set_budget to change the budget or plan_kit to re-plan it; to start over and discard it, call create_mission again with replace: true`);
    }
    try {
      const m = await createMission(input);
      return withDelta(AGENT_DEFAULT, { mission: compact(m), replaced: cur ? cur.id : null });
    } catch (e) {
      return err(AGENT_DEFAULT, (e as Error).message);
    }
  },
  set_budget: async (args) => {
    try {
      const r = await act("agent", "set_budget", args as Record<string, unknown>);
      return withDelta(AGENT_DEFAULT, { budget: money(r.mission.budget_total_cents, r.mission.currency), totals: r.totals });
    } catch (e) {
      return err(AGENT_DEFAULT, (e as Error).message);
    }
  },
  plan_kit: async (args) => {
    try {
      const r = await act("agent", "plan", args as Record<string, unknown>);
      return withDelta(AGENT_DEFAULT, { notes: r.notes, kept_slots: r.kept ?? [], slots: r.mission.slots.map(compactSlot) });
    } catch (e) {
      return err(AGENT_DEFAULT, (e as Error).message);
    }
  },
  search_products: async (args) => {
    try {
      const r = await act("agent", "search", args as Record<string, unknown>);
      const cands = (r.candidates as Candidate[]).map(compactCandidate);
      return withDelta(AGENT_DEFAULT, { slot_id: (args as { slot_id: string }).slot_id, candidates: cands, sources: r.sources, errors: r.errors ?? [] });
    } catch (e) {
      return err(AGENT_DEFAULT, (e as Error).message);
    }
  },
  choose_candidate: async (args) => {
    try {
      const r = await act("agent", "choose", args as Record<string, unknown>);
      return withDelta(AGENT_DEFAULT, { totals: { selected: money(r.totals.selected_cents), remaining: money(r.totals.remaining_cents ?? undefined), over_budget: r.totals.over_budget, required_unfilled: r.totals.required_unfilled } });
    } catch (e) {
      return err(AGENT_DEFAULT, (e as Error).message);
    }
  },
  explain_tradeoffs: async (args) => {
    try {
      const r = await act("agent", "explain", args as Record<string, unknown>);
      const tr = r.tradeoffs as Record<string, { chosen_because: string; vs_alternatives: { candidate_id: string; tradeoff: string }[]; budget_note: string }>;
      const single = typeof (args as { slot_id?: string }).slot_id === "string";
      // All-slots mode returns summaries only (the alternatives are on the board); one slot returns the full tradeoffs.
      const slots = Object.entries(tr).map(([slot_id, t]) => (single ? { slot_id, chosen_because: t.chosen_because, vs_alternatives: t.vs_alternatives, budget_note: t.budget_note } : { slot_id, chosen_because: t.chosen_because, budget_note: t.budget_note }));
      return withDelta(AGENT_DEFAULT, { slots, shown_on_board: true });
    } catch (e) {
      return err(AGENT_DEFAULT, (e as Error).message);
    }
  },
  prepare_checkout: async () => {
    try {
      const r = await act("agent", "prepare_checkout");
      return withDelta(AGENT_DEFAULT, { checkouts: compact(r.mission)?.checkouts });
    } catch (e) {
      return err(AGENT_DEFAULT, (e as Error).message);
    }
  },
  get_checkout_status: async () => {
    await refresh();
    const m = currentMission();
    const c = compact(m);
    return withDelta(AGENT_DEFAULT, { checkouts: c?.checkouts ?? [], selected_total: c?.selected_total, budget: c?.budget, over_budget: c?.over_budget });
  },
};

export const tools: (ToolDefinition & { stage: Stage })[] = specs.map((s) => {
  const execute = executors[s.name];
  if (!execute) throw new Error(`no executor for tool ${s.name}`);
  return { ...s, execute };
});
