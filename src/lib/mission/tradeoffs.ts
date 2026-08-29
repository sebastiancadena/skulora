/**
 * explain_tradeoffs: why the selected item in a slot beats its alternatives, grounded on the board.
 * One strict-schema LLM call over board data only; candidate ids and prices are copied from the board,
 * never taken from the model (grounding rule). Output is capped so a tool result stays ≈ ≤ 1.5 KB.
 */
import { generateJson } from "../llm";
import { missionTotals, selectedCandidate, type Mission, type Slot } from "./types";

export const MAX_SLOTS = 6;
const MAX_ALTS = 2;
const MAX_TEXT = 160;

export interface SlotTradeoffs {
  chosen_because: string;
  vs_alternatives: { candidate_id: string; tradeoff: string }[];
  budget_note: string;
  at: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slots"],
  properties: {
    slots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slot_id", "chosen_because", "vs_alternatives", "budget_note"],
        properties: {
          slot_id: { type: "string" },
          chosen_because: { type: "string", description: "One sentence, ≤ 140 characters: why the selected item, tied to the mission constraints" },
          vs_alternatives: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["candidate_id", "tradeoff"],
              properties: { candidate_id: { type: "string" }, tradeoff: { type: "string", description: "≤ 100 characters: what you give up or gain vs the selection" } },
            },
          },
          budget_note: { type: "string", description: "≤ 80 characters: this slot's price vs its budget share" },
        },
      },
    },
  },
} as const;

type Out = { slots: { slot_id: string; chosen_because: string; vs_alternatives: { candidate_id: string; tradeoff: string }[]; budget_note: string }[] };

const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1).trimEnd() + "…" : s);

/** Slots eligible for an explanation: selected, optionally narrowed to one id. */
export function explainableSlots(m: Mission, slotId?: string): Slot[] {
  if (slotId) {
    const s = m.slots.find((x) => x.id === slotId);
    if (!s) throw new Error(`unknown slot_id ${slotId}; slots: ${m.slots.map((x) => x.id).join(", ")}`);
    if (!s.selected) throw new Error(`slot ${slotId} has no selection yet; call choose_candidate first`);
    return [s];
  }
  const sel = m.slots.filter((s) => s.selected);
  if (sel.length === 0) throw new Error("no slot has a selection yet; call choose_candidate first");
  return sel.slice(0, MAX_SLOTS);
}

export async function explainTradeoffs(m: Mission, slots: Slot[], signal?: AbortSignal): Promise<Record<string, SlotTradeoffs>> {
  const t = missionTotals(m);
  const money = (c: number) => `${(c / 100).toFixed(2)} ${m.currency}`;
  const system = [
    "You explain a shopping kit's choices to the person who co-plans it. Output only the JSON schema.",
    "Use only the facts given; never invent specs, prices or products. Tie reasons to the mission constraints and the person's rejections/locks.",
    "Be concrete and short; respect the character limits in the schema descriptions. Plain words, no marketing, no restating the product title.",
    `Only reference candidate_id values listed under alternatives. At most ${MAX_ALTS} alternatives per slot, most relevant first.`,
  ].join("\n");
  const user = JSON.stringify({
    mission: { goal: m.goal, constraints: m.constraints, owned_items: m.owned_items, budget: m.budget_total_cents == null ? null : money(m.budget_total_cents), selected_total: money(t.selected_cents), over_budget: t.over_budget },
    slots: slots.map((s) => {
      const sel = selectedCandidate(s)!;
      const rejected = new Map(s.rejected.map((r) => [r.candidate_id, r.reason ?? ""]));
      return {
        slot_id: s.id,
        need: s.need,
        constraints: s.constraints,
        budget_share: s.budget_hint_cents == null ? null : money(s.budget_hint_cents),
        locked_by_person: s.locked,
        selected: { title: sel.title, merchant: sel.merchant_domain, price: money(sel.price_cents), why: sel.why_it_fits, caveats: sel.caveats },
        alternatives: s.candidates
          .filter((c) => c.id !== sel.id)
          .slice(0, 5)
          .map((c) => ({ candidate_id: c.id, title: c.title, merchant: c.merchant_domain, price: money(c.price_cents), why: c.why_it_fits, caveats: c.caveats, rejected_by_person: rejected.has(c.id) ? rejected.get(c.id) || true : false })),
      };
    }),
  });
  const out = await generateJson<Out>({ name: "tradeoffs", schema: SCHEMA as unknown as Record<string, unknown>, system, user, signal });
  const at = new Date().toISOString();
  const result: Record<string, SlotTradeoffs> = {};
  for (const s of slots) {
    const o = out.slots.find((x) => x.slot_id === s.id);
    if (!o) continue;
    const valid = new Set(s.candidates.map((c) => c.id));
    result[s.id] = {
      chosen_because: clip(o.chosen_because),
      vs_alternatives: o.vs_alternatives.filter((a) => valid.has(a.candidate_id) && a.candidate_id !== s.selected).slice(0, MAX_ALTS).map((a) => ({ candidate_id: a.candidate_id, tradeoff: clip(a.tradeoff) })),
      budget_note: clip(o.budget_note),
      at,
    };
  }
  return result;
}
