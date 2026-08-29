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
  locked: boolean;
  rejected: { candidate_id: string; reason?: string }[];
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
