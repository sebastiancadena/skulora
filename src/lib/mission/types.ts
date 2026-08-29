/** Shared mission model (server is the source of truth; the browser holds a cache). */

export type Actor = "human" | "agent";

export interface MissionEvent {
  seq: number;
  at: string;
  actor: Actor;
  type: string;
  detail?: unknown;
}

export interface Candidate {
  id: string; // short board id, e.g. c_ab12cd
  product_id: string;
  variant_id?: string;
  title: string;
  merchant_domain: string;
  merchant_name?: string;
  price_cents: number;
  currency: string;
  url?: string;
  image?: string;
  available: boolean;
  why_it_fits: string[];
  caveats: string[];
  source: "global" | "store";
}

export interface Slot {
  id: string; // s_pack, s_bag …
  need: string; // "Backpack, 45–60 L"
  why: string; // one sentence for the board
  constraints: string[];
  required: boolean;
  budget_hint_cents?: number;
  search_query: string;
  tags: string[]; // merchant tags from merchants.json vocabulary
  candidates: Candidate[];
  selected?: string; // candidate id
  selected_by?: Actor; // who made the current selection
  selected_reason?: string; // the agent's one-line reason (choose_candidate) — shown on the card
  locked: boolean;
  rejected: { candidate_id: string; reason?: string }[];
  tradeoffs?: { chosen_because: string; vs_alternatives: { candidate_id: string; tradeoff: string }[]; budget_note: string; at: string }; // from explain_tradeoffs
}

export interface MerchantCart {
  merchant_domain: string;
  cart_id?: string;
  checkout_url?: string;
  total_cents: number;
  currency: string;
  lines: { candidate_id: string; title: string; price_cents: number }[];
  error?: string;
}

export interface Mission {
  id: string;
  version: number; // bumped on every change; human actions carry the version they were taken against
  created_at: string;
  updated_at: string;
  goal: string;
  budget_total_cents?: number;
  currency: string;
  owned_items: string[];
  constraints: string[];
  slots: Slot[];
  carts: Record<string, MerchantCart>;
  events: MissionEvent[];
}

export const MERCHANT_TAGS = ["outdoor", "packs", "hunting", "apparel", "activewear", "footwear", "hydration", "kitchen", "coffee", "home"] as const;
export type MerchantTag = (typeof MERCHANT_TAGS)[number];

export function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** One plain-English line per board event, shared by the board, the agent panel and the event log. */
export function describeEvent(e: Pick<MissionEvent, "type" | "detail">, m?: Mission | null): string {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const slot = m?.slots.find((s) => s.id === d.slot_id);
  const need = slot?.need ?? (typeof d.slot_id === "string" ? d.slot_id : "slot");
  const title = typeof d.title === "string" ? d.title : slot?.candidates.find((c) => c.id === d.candidate_id)?.title;
  const item = title ? `“${title.length > 44 ? title.slice(0, 44).replace(/\s+\S*$/, "") + "…" : title}”` : "";
  const reason = typeof d.reason === "string" && d.reason ? ` — ${d.reason}` : "";
  switch (e.type) {
    case "locked": return `Locked ${need}${item ? ` on ${item}` : ""}`;
    case "unlocked": return `Unlocked ${need}`;
    case "rejected": return `Rejected ${item || "a candidate"} for ${need}${reason}`;
    case "human_chose": return `Chose ${item} for ${need}`;
    case "choose_candidate": return `Agent picked ${item} for ${need}${reason}`;
    case "budget_changed": return `Budget set to ${((d.budget_total_cents as number) / 100).toFixed(0)}`;
    case "plan_kit": return `Planned ${(d.slots as string[] | undefined)?.length ?? 0} slots`;
    case "search_products": return `Searched ${need}: ${d.added ?? 0} new candidates`;
    case "explain_tradeoffs": return `Explained ${(d.slots as string[] | undefined)?.length ?? 0} picks`;
    case "prepare_checkout": return `Prepared checkout at ${(d.merchants as string[] | undefined)?.length ?? 0} merchants`;
    default: return e.type;
  }
}

export function selectedCandidate(slot: Slot): Candidate | undefined {
  return slot.candidates.find((c) => c.id === slot.selected);
}

export function missionTotals(m: Mission) {
  let selected_cents = 0;
  const byMerchant: Record<string, number> = {};
  for (const s of m.slots) {
    const c = selectedCandidate(s);
    if (!c) continue;
    selected_cents += c.price_cents;
    byMerchant[c.merchant_domain] = (byMerchant[c.merchant_domain] ?? 0) + c.price_cents;
  }
  const budget = m.budget_total_cents;
  return {
    selected_cents,
    budget_total_cents: budget,
    remaining_cents: budget == null ? null : budget - selected_cents,
    over_budget: budget != null && selected_cents > budget,
    merchants: Object.keys(byMerchant).length,
    by_merchant_cents: byMerchant,
    required_unfilled: m.slots.filter((s) => s.required && !s.selected).map((s) => s.id),
  };
}
