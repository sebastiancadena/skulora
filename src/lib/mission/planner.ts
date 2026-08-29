/** Mission → slots. One strict-schema LLM call. */
import { generateJson } from "../llm";
import { MERCHANT_TAGS, type Mission, type Slot } from "./types";

const SLOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slots", "notes"],
  properties: {
    notes: { type: "string", description: "One sentence to the person about how the kit was split up" },
    slots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "need", "why", "constraints", "required", "budget_hint_cents", "search_query", "tags"],
        properties: {
          id: { type: "string", description: "snake_case, e.g. backpack, sleeping_bag" },
          need: { type: "string", description: "Short label with the key spec, e.g. 'Backpack, 45–60 L'" },
          why: { type: "string", description: "One sentence: why this item, tied to the mission" },
          constraints: { type: "array", items: { type: "string" } },
          required: { type: "boolean" },
          budget_hint_cents: { type: "integer", description: "Suggested share of the total budget for this slot, in cents" },
          search_query: { type: "string", description: "Product search query a store would understand, 2–6 words" },
          tags: { type: "array", items: { type: "string", enum: [...MERCHANT_TAGS] } },
        },
      },
    },
  },
} as const;

type PlanOut = { notes: string; slots: Omit<Slot, "candidates" | "selected" | "locked" | "rejected">[] };

export async function planKit(m: Mission, style: "minimal" | "balanced" | "premium" = "balanced", signal?: AbortSignal) {
  const budget = m.budget_total_cents != null ? `${(m.budget_total_cents / 100).toFixed(0)} ${m.currency}` : "not set";
  const system = [
    "You plan shopping kits for a person's mission. Output only the JSON schema.",
    "Rules: 4–9 slots. Never include items the person already owns. Each slot is one purchasable product type.",
    "Respect the constraints literally (e.g. 'runs hot at night' → warmer-rated bag is wrong, pick a lighter/ventilated one).",
    "budget_hint_cents across required slots must sum to at most the total budget (leave ~10% headroom); optional slots may exceed it.",
    `Style: ${style} (minimal = fewest items and cheapest sensible; premium = best-in-class within budget).`,
    "search_query must be what a shopper would type into a store search box, no brand names.",
    "tags: pick from the allowed list the merchant categories most likely to sell the item.",
  ].join("\n");
  const user = JSON.stringify({
    goal: m.goal,
    budget_total: budget,
    owned_items: m.owned_items,
    constraints: m.constraints,
  });
  const out = await generateJson<PlanOut>({ name: "kit_plan", schema: SLOT_SCHEMA as unknown as Record<string, unknown>, system, user, signal });
  const slots: Slot[] = out.slots.map((s) => ({
    ...s,
    id: s.id.replace(/[^a-z0-9_]/gi, "_").toLowerCase(),
    candidates: [],
    locked: false,
    rejected: [],
  }));
  return { notes: out.notes, slots };
}
