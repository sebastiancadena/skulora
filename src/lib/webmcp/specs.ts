/**
 * Tool metadata — name, description, schema, stage — with no executors and no browser imports.
 * The page pairs these with their `execute` in `tools.ts`; `/api/agent` builds the model's tool
 * list straight from here, so the client never gets to say what tools the agent may call.
 */
import type { JsonSchema, ToolAnnotations } from "./types";

export type Stage = "A" | "B" | "C";

export type ToolSpec = {
  stage: Stage;
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
};

const noArgs = { type: "object", properties: {}, additionalProperties: false };

export const specs: ToolSpec[] = [
  // ---------- Stage A: always ----------
  {
    stage: "A",
    name: "get_mission",
    title: "Get mission",
    description:
      "Read the shopping mission board: goal, budget, constraints, owned items, slots with selections, locks and rejections, totals. Call this first and whenever the person may have edited the board. Includes mission_delta: the person's edits since your last call.",
    inputSchema: noArgs,
    annotations: { readOnlyHint: true },
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
  },
  {
    stage: "A",
    name: "set_budget",
    title: "Set budget",
    description: "Change the mission's total budget across all merchants, in cents.",
    inputSchema: { type: "object", properties: { budget_total_cents: { type: "integer", minimum: 0 } }, required: ["budget_total_cents"], additionalProperties: false },
  },

  // ---------- Stage B: once a mission exists ----------
  {
    stage: "B",
    name: "plan_kit",
    title: "Plan kit",
    description:
      "Break the mission into product slots (e.g. backpack, sleeping bag) with constraints, a budget share and a search query each, respecting owned items and the total budget. Locked slots are kept. Then call search_products per slot.",
    inputSchema: { type: "object", properties: { style: { type: "string", enum: ["minimal", "balanced", "premium"] } }, additionalProperties: false },
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
  },
  {
    stage: "B",
    name: "explain_tradeoffs",
    title: "Explain tradeoffs",
    description:
      "Explain why the selected item in a slot beats its alternatives, in the person's terms: fit to constraints, what each alternative gives up, and price versus the slot's budget share. Grounded on the board only. Omit slot_id to explain every selected slot (max 6). Writes the explanation onto the board, so call it after choosing and again after the person locks or rejects something.",
    inputSchema: { type: "object", properties: { slot_id: { type: "string", description: "Slot id; omit for all selected slots" } }, additionalProperties: false },
    annotations: { idempotentHint: true },
  },

  // ---------- Stage C: every required slot filled ----------
  {
    stage: "C",
    name: "prepare_checkout",
    title: "Prepare checkout",
    description:
      "Create one real cart per merchant from the selected candidates and show the person a checkout card per merchant on the board. Does not purchase anything — the person completes each checkout. Call once the kit is final and within budget.",
    inputSchema: noArgs,
  },
  {
    stage: "C",
    name: "get_checkout_status",
    title: "Get checkout status",
    description: "Which merchants have carts ready, their totals, and the grand total versus budget.",
    inputSchema: noArgs,
    annotations: { readOnlyHint: true },
  },
];

export const TOOL_NAMES = new Set(specs.map((s) => s.name));
