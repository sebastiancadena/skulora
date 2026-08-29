/**
 * The Outfitter tool table. One source of truth consumed by:
 *   - the browser's WebMCP surface (document.modelContext.registerTool)
 *   - the built-in agent (same name/schema/execute, no browser support needed)
 *
 * Stage A tools only for now (see PRD §6). Stage B/C arrive with the planner.
 */
import type { ToolDefinition } from "./types";
import { delta, getMission, newId, update, type Mission } from "../mission/store";

/** Per-agent cursor so `mission_delta` reports only what the human did since the agent's last call. */
const cursors = new Map<string, number>();

function withDelta(agent: string, body: Record<string, unknown>) {
  const since = cursors.get(agent) ?? 0;
  const m = getMission();
  const last = m?.events.at(-1)?.seq ?? 0;
  cursors.set(agent, last);
  return { ...body, mission_delta: delta(since).map((e) => ({ type: e.type, detail: e.detail })) };
}

function compact(m: Mission | null) {
  if (!m) return null;
  return {
    id: m.id,
    goal: m.goal,
    budget_total_cents: m.budget_total_cents,
    currency: m.currency,
    owned_items: m.owned_items,
    constraints: m.constraints,
    slots: m.slots.map((s) => ({ id: s.id, need: s.need, selected: s.selected ?? null, locked: !!s.locked, rejected: s.rejected.length })),
  };
}

export const AGENT_DEFAULT = "webmcp";

export const tools: ToolDefinition[] = [
  {
    name: "get_mission",
    title: "Get mission",
    description:
      "Read the current shopping mission on the board: goal, budget, constraints, owned items, slots and their selections. Call first. Includes mission_delta: edits the person made since your last call.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: () => withDelta(AGENT_DEFAULT, { mission: compact(getMission()) }),
  },
  {
    name: "create_mission",
    title: "Create mission",
    description:
      "Start a new shopping mission from the person's goal, e.g. 'outfit me for a 3-day desert backpacking trip'. Replaces any existing mission on the board.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The mission in the person's words" },
        budget_total_cents: { type: "integer", description: "Total budget across all merchants, in cents" },
        currency: { type: "string", description: "ISO 4217, default USD" },
        owned_items: { type: "array", items: { type: "string" }, description: "Gear the person already has; never shop for these" },
        constraints: { type: "array", items: { type: "string" }, description: "Preferences such as 'runs hot at night'" },
      },
      required: ["goal"],
      additionalProperties: false,
    },
    execute: (args) => {
      const a = args as { goal: string; budget_total_cents?: number; currency?: string; owned_items?: string[]; constraints?: string[] };
      const m = update("agent", "create_mission", () => ({
        id: newId("m"),
        goal: a.goal,
        budget_total_cents: a.budget_total_cents,
        currency: a.currency ?? "USD",
        owned_items: a.owned_items ?? [],
        constraints: a.constraints ?? [],
        slots: [],
        events: [],
      }));
      return withDelta(AGENT_DEFAULT, { mission: compact(m), next_suggested_tools: ["plan_kit"] });
    },
  },
  {
    name: "set_budget",
    title: "Set budget",
    description: "Change the mission's total budget across all merchants, in cents.",
    inputSchema: {
      type: "object",
      properties: { budget_total_cents: { type: "integer", minimum: 0 } },
      required: ["budget_total_cents"],
      additionalProperties: false,
    },
    execute: (args) => {
      const { budget_total_cents } = args as { budget_total_cents: number };
      const m = update("agent", "set_budget", (m) => (m ? { ...m, budget_total_cents } : m), { budget_total_cents });
      return withDelta(AGENT_DEFAULT, m ? { mission: compact(m) } : { error: "no mission yet; call create_mission" });
    },
  },
];
