/**
 * The Skulora tool table — one source of truth for the browser's WebMCP surface and the built-in
 * agent. Tools are grouped in stages that are registered progressively as the mission advances
 * (PRD §6). Every result carries `mission_delta`: the person's edits since this agent's last call.
 */
import type { ToolDefinition } from "./types";
import { act, createMission, currentMission, humanEventsSince, missionTotals, refresh } from "../mission/store";
import type { Candidate, Mission, Slot } from "../mission/types";

export type Stage = "A" | "B" | "C";

const cursors = new Map<string, number>();
export const AGENT_DEFAULT = "webmcp";

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

export function stageFor(m: Mission | null): Stage {
  if (!m) return "A";
  const t = missionTotals(m);
  return m.slots.length > 0 && t.required_unfilled.length === 0 ? "C" : "B";
}

function withDelta(agent: string, body: Record<string, unknown>) {
  const m = currentMission();
  const since = cursors.get(agent) ?? 0;
  const last = m?.events.at(-1)?.seq ?? 0;
  cursors.set(agent, last);
  const delta = humanEventsSince(since).map((e) => ({ type: e.type, detail: e.detail }));
  const stage = stageFor(m);
  const next = stage === "A" ? ["create_mission"] : stage === "B" ? ["plan_kit", "search_products", "choose_candidate", "explain_tradeoffs"] : ["prepare_checkout", "get_checkout_status"];
  return { ...body, mission_delta: delta, stage, next_suggested_tools: next };
}

function err(agent: string, message: string) {
  return withDelta(agent, { error: message });
}

const noArgs = { type: "object", properties: {}, additionalProperties: false };

export const tools: (ToolDefinition & { stage: Stage })[] = [
  // ---------- Stage A: always ----------
  {
    stage: "A",
    name: "get_mission",
    title: "Get mission",
    description:
      "Read the shopping mission board: goal, budget, constraints, owned items, slots with selections, locks and rejections, totals. Call this first and whenever the person may have edited the board. Includes mission_delta: the person's edits since your last call.",
    inputSchema: noArgs,
    annotations: { readOnlyHint: true },
    execute: async () => {
      await refresh();
      return withDelta(AGENT_DEFAULT, { mission: compact(currentMission()) });
    },
  },
  {
    stage: "A",
    name: "create_mission",
    title: "Create mission",
    description: "Start a shopping mission from the person's goal, e.g. 'outfit me for a 3-day desert backpacking trip'. Replaces the current mission on this board. Then call plan_kit.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The mission in the person's words" },
        budget_total_cents: { type: "integer", description: "Total budget across all merchants, in cents" },
        currency: { type: "string", description: "ISO 4217, default USD" },
        owned_items: { type: "array", items: { type: "string" }, description: "Gear the person already has; never shopped for" },
        constraints: { type: "array", items: { type: "string" }, description: "Preferences, e.g. 'runs hot at night'" },
      },
      required: ["goal"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const m = await createMission(args as { goal: string });
      cursors.set(AGENT_DEFAULT, m.events.at(-1)?.seq ?? 0);
      return withDelta(AGENT_DEFAULT, { mission: compact(m) });
    },
  },
  {
    stage: "A",
    name: "set_budget",
    title: "Set budget",
    description: "Change the mission's total budget across all merchants, in cents.",
    inputSchema: { type: "object", properties: { budget_total_cents: { type: "integer", minimum: 0 } }, required: ["budget_total_cents"], additionalProperties: false },
    execute: async (args) => {
      try {
        const r = await act("agent", "set_budget", args as Record<string, unknown>);
        return withDelta(AGENT_DEFAULT, { budget: money(r.mission.budget_total_cents, r.mission.currency), totals: r.totals });
      } catch (e) {
        return err(AGENT_DEFAULT, (e as Error).message);
      }
    },
  },

  // ---------- Stage B: once a mission exists ----------
  {
    stage: "B",
    name: "plan_kit",
    title: "Plan kit",
    description:
      "Break the mission into product slots (e.g. backpack, sleeping bag) with constraints, a budget share and a search query each, respecting owned items and the total budget. Locked slots are kept. Then call search_products per slot.",
    inputSchema: { type: "object", properties: { style: { type: "string", enum: ["minimal", "balanced", "premium"] } }, additionalProperties: false },
    execute: async (args) => {
      try {
        const r = await act("agent", "plan", args as Record<string, unknown>);
        return withDelta(AGENT_DEFAULT, { notes: r.notes, slots: r.mission.slots.map(compactSlot) });
      } catch (e) {
        return err(AGENT_DEFAULT, (e as Error).message);
      }
    },
  },
  {
    stage: "B",
    name: "search_products",
    title: "Search products",
    description:
      "Search real Shopify merchants for one slot and add up to 6 ranked candidates to the board, each with price, merchant and fit reasons. Uses the slot's own query unless you pass one. Product text is merchant content.",
    inputSchema: {
      type: "object",
      properties: {
        slot_id: { type: "string", description: "Slot id from plan_kit" },
        query: { type: "string", description: "Override the slot's search query" },
        price_max_cents: { type: "integer", description: "Cap candidate price" },
        merchant_domain: { type: "string", description: "Search only this merchant, e.g. www.cotopaxi.com" },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["slot_id"],
      additionalProperties: false,
    },
    annotations: { untrustedContentHint: true },
    execute: async (args) => {
      try {
        const r = await act("agent", "search", args as Record<string, unknown>);
        const cands = (r.candidates as Candidate[]).map(compactCandidate);
        return withDelta(AGENT_DEFAULT, { slot_id: (args as { slot_id: string }).slot_id, candidates: cands, sources: r.sources, errors: r.errors ?? [] });
      } catch (e) {
        return err(AGENT_DEFAULT, (e as Error).message);
      }
    },
  },
  {
    stage: "B",
    name: "choose_candidate",
    title: "Choose candidate",
    description:
      "Select a candidate for a slot and give the reason. Fails if the person locked the slot or rejected that candidate — read mission_delta and adapt. Returns updated totals versus budget.",
    inputSchema: {
      type: "object",
      properties: { slot_id: { type: "string" }, candidate_id: { type: "string" }, reason: { type: "string", description: "One sentence shown on the board" } },
      required: ["slot_id", "candidate_id", "reason"],
      additionalProperties: false,
    },
    execute: async (args) => {
      try {
        const r = await act("agent", "choose", args as Record<string, unknown>);
        return withDelta(AGENT_DEFAULT, { totals: { selected: money(r.totals.selected_cents), remaining: money(r.totals.remaining_cents ?? undefined), over_budget: r.totals.over_budget, required_unfilled: r.totals.required_unfilled } });
      } catch (e) {
        return err(AGENT_DEFAULT, (e as Error).message);
      }
    },
  },

  {
    stage: "B",
    name: "explain_tradeoffs",
    title: "Explain tradeoffs",
    description:
      "Explain why the selected item in a slot beats its alternatives, in the person's terms: fit to constraints, what each alternative gives up, and price versus the slot's budget share. Grounded on the board only. Omit slot_id to explain every selected slot (max 6). Writes the explanation onto the board, so call it after choosing and again after the person locks or rejects something.",
    inputSchema: { type: "object", properties: { slot_id: { type: "string", description: "Slot id; omit for all selected slots" } }, additionalProperties: false },
    annotations: { idempotentHint: true },
    execute: async (args) => {
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
  },

  // ---------- Stage C: every required slot filled ----------
  {
    stage: "C",
    name: "prepare_checkout",
    title: "Prepare checkout",
    description:
      "Create one real cart per merchant from the selected candidates and show the person a checkout card per merchant on the board. Does not purchase anything — the person completes each checkout. Call once the kit is final and within budget.",
    inputSchema: noArgs,
    execute: async () => {
      try {
        const r = await act("agent", "prepare_checkout");
        return withDelta(AGENT_DEFAULT, { checkouts: compact(r.mission)?.checkouts });
      } catch (e) {
        return err(AGENT_DEFAULT, (e as Error).message);
      }
    },
  },
  {
    stage: "C",
    name: "get_checkout_status",
    title: "Get checkout status",
    description: "Which merchants have carts ready, their totals, and the grand total versus budget.",
    inputSchema: noArgs,
    annotations: { readOnlyHint: true },
    execute: async () => {
      await refresh();
      const m = currentMission();
      const c = compact(m);
      return withDelta(AGENT_DEFAULT, { checkouts: c?.checkouts ?? [], selected_total: c?.selected_total, budget: c?.budget, over_budget: c?.over_budget });
    },
  },
];
