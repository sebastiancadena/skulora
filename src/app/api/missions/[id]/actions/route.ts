/**
 * All mission mutations go through here, from the board (human) and from tools (agent).
 * Body: { actor, type, version?, ...fields }. Human actions may carry the version they were taken
 * against; a stale version is still applied but flagged so the agent's next mission_delta explains it.
 */
export const maxDuration = 60; // plan + fan-out search can exceed the 10 s default

import { getMission, mutateMission, NotFound } from "@/lib/mission/repo";
import { dailyBudget, rateLimit } from "@/lib/ratelimit";
import { planKit } from "@/lib/mission/planner";
import { searchForSlot } from "@/lib/mission/search";
import { prepareCheckout } from "@/lib/mission/checkout";
import { explainableSlots, explainTradeoffs } from "@/lib/mission/tradeoffs";
import { missionTotals, type Actor, type Mission, type Slot } from "@/lib/mission/types";

type Body = { actor?: Actor; type: string; version?: number; [k: string]: unknown };

/** Slots a re-plan must not touch: locked by the person, or holding the person's own pick. */
function keptOnReplan(s: Slot) {
  return s.locked || (!!s.selected && s.selected_by === "human");
}

function findSlot(m: Mission, id: unknown): Slot {
  const s = m.slots.find((x) => x.id === id);
  if (!s) throw new Error(`unknown slot_id ${String(id)}; slots: ${m.slots.map((x) => x.id).join(", ")}`);
  return s;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(req, "actions");
  if (limited) return limited;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.type) return Response.json({ error: "type required" }, { status: 400 });
  // plan, search and explain call the model on our key whoever is driving the board — ChatGPT
  // included — so they carry a daily ceiling. The rest (locking, rejecting, choosing, budget,
  // checkout) cost us no tokens and must never be refused for budget: a person editing their own
  // board is not what runs up a bill.
  if (body.type === "plan" || body.type === "search" || body.type === "explain") {
    const spent = await dailyBudget(req, "actions");
    if (spent) return spent;
  }
  const actor: Actor = body.actor === "human" ? "human" : "agent";
  const extra: Record<string, unknown> = {};

  try {
    // Slow, side-effect-free work happens here against a snapshot; the mutation below is cheap and retried on conflict.
    const snapshot = await getMission(id);
    if (!snapshot) throw new NotFound(id);
    let planned: Awaited<ReturnType<typeof planKit>> | undefined;
    let searched: Awaited<ReturnType<typeof searchForSlot>> | undefined;
    let checkout: Awaited<ReturnType<typeof prepareCheckout>> | undefined;
    let explained: Awaited<ReturnType<typeof explainTradeoffs>> | undefined;
    if (body.type === "plan") {
      const style = (["minimal", "balanced", "premium"] as const).find((s) => s === body.style) ?? "balanced";
      // A re-plan keeps what the person locked and what the person chose (an unlocked pick is still
      // theirs); the planner is told those needs are covered so it does not plan them twice.
      planned = await planKit(snapshot, style, req.signal, snapshot.slots.filter(keptOnReplan).map((s) => s.need));
      extra.style = style;
    } else if (body.type === "search") {
      searched = await searchForSlot(snapshot, findSlot(snapshot, body.slot_id), {
        query: typeof body.query === "string" ? body.query : undefined,
        price_max_cents: typeof body.price_max_cents === "number" ? body.price_max_cents : undefined,
        merchant_domain: typeof body.merchant_domain === "string" ? body.merchant_domain : undefined,
        limit: typeof body.limit === "number" ? body.limit : undefined,
        signal: req.signal,
      });
    } else if (body.type === "prepare_checkout") {
      const unfilled = missionTotals(snapshot).required_unfilled;
      if (unfilled.length) throw new Error(`required slots have no selection yet: ${unfilled.join(", ")}; search_products and choose_candidate for them first`);
      checkout = await prepareCheckout(snapshot, req.signal);
    } else if (body.type === "explain") {
      const slotId = typeof body.slot_id === "string" ? body.slot_id : undefined;
      explained = await explainTradeoffs(snapshot, explainableSlots(snapshot, slotId), req.signal);
    }

    const m = await mutateMission(id, (m) => {
      const log = (type: string, detail?: unknown) =>
        m.events.push({ seq: (m.events.at(-1)?.seq ?? 0) + 1, at: new Date().toISOString(), actor, type, detail });
      const stale = typeof body.version === "number" && body.version !== m.version;
      // Carts were built from the selections at prepare_checkout time; once the kit changes they no
      // longer describe it, so they leave the board rather than sit under a different pick.
      const resetCarts = () => {
        if (Object.keys(m.carts).length === 0) return;
        m.carts = {};
        log("checkout_reset");
      };

      switch (body.type) {
        case "set_budget": {
          const cents = Math.round(Number(body.budget_total_cents));
          if (!Number.isFinite(cents) || cents < 0) throw new Error("budget_total_cents must be a non-negative integer");
          m.budget_total_cents = cents;
          log("budget_changed", { budget_total_cents: cents, stale });
          break;
        }
        case "plan": {
          const { notes, slots } = planned!;
          const kept = m.slots.filter(keptOnReplan);
          m.slots = [...kept, ...slots.filter((s) => !kept.some((k) => k.id === s.id))];
          resetCarts();
          extra.notes = notes;
          extra.kept = kept.map((s) => s.id);
          log("plan_kit", { style: extra.style, slots: m.slots.map((s) => s.id), kept: extra.kept });
          break;
        }
        case "search": {
          const slot = findSlot(m, body.slot_id);
          const r = searched!;
          const existing = new Set(slot.candidates.map((c) => c.product_id));
          const added = r.candidates.filter((c) => !existing.has(c.product_id));
          slot.candidates.push(...added);
          // Report ids as they exist on the board (a duplicate product keeps its earlier id).
          extra.candidates = r.candidates.map((c) => slot.candidates.find((x) => x.product_id === c.product_id) ?? c);
          extra.sources = r.sources;
          if (r.errors.length) extra.errors = r.errors;
          log("search_products", { slot_id: slot.id, added: added.length });
          break;
        }
        case "choose": {
          const slot = findSlot(m, body.slot_id);
          if (slot.locked && actor === "agent") throw new Error(`slot ${slot.id} is locked by the person; ask before changing it`);
          const c = slot.candidates.find((x) => x.id === body.candidate_id);
          if (!c) throw new Error(slot.candidates.length ? `unknown candidate_id for slot ${slot.id}; candidates: ${slot.candidates.map((x) => x.id).join(", ")}` : `slot ${slot.id} has no candidates yet; call search_products for it first`);
          if (slot.rejected.some((r) => r.candidate_id === c.id) && actor === "agent") throw new Error(`candidate ${c.id} was rejected by the person`);
          if (slot.selected !== c.id) {
            slot.tradeoffs = undefined; // explanation belonged to the previous pick
            resetCarts();
          }
          slot.selected = c.id;
          slot.selected_by = actor;
          slot.selected_reason = actor === "agent" && typeof body.reason === "string" ? body.reason : undefined;
          log(actor === "human" ? "human_chose" : "choose_candidate", { slot_id: slot.id, candidate_id: c.id, title: c.title, price_cents: c.price_cents, reason: body.reason, stale });
          break;
        }
        case "lock": {
          const slot = findSlot(m, body.slot_id);
          slot.locked = body.locked !== false;
          log(slot.locked ? "locked" : "unlocked", { slot_id: slot.id, candidate_id: slot.selected, stale });
          break;
        }
        case "reject": {
          const slot = findSlot(m, body.slot_id);
          const cid = String(body.candidate_id ?? slot.selected ?? "");
          if (!cid) throw new Error("candidate_id required");
          slot.rejected.push({ candidate_id: cid, reason: typeof body.reason === "string" ? body.reason : undefined });
          if (slot.selected === cid) {
            slot.selected = undefined;
            slot.selected_by = undefined;
            slot.selected_reason = undefined;
            slot.tradeoffs = undefined;
            resetCarts();
          }
          const c = slot.candidates.find((x) => x.id === cid);
          log("rejected", { slot_id: slot.id, candidate_id: cid, title: c?.title, reason: body.reason, stale });
          break;
        }
        case "explain": {
          // Explanations were computed against the snapshot; keep only those whose selection is unchanged.
          const kept: string[] = [];
          for (const [sid, tr] of Object.entries(explained!)) {
            const slot = m.slots.find((s) => s.id === sid);
            const snap = snapshot.slots.find((s) => s.id === sid);
            if (!slot || !snap || slot.selected !== snap.selected) continue;
            slot.tradeoffs = tr;
            kept.push(sid);
          }
          extra.tradeoffs = Object.fromEntries(kept.map((sid) => [sid, explained![sid]]));
          log("explain_tradeoffs", { slots: kept });
          break;
        }
        case "prepare_checkout": {
          const r = checkout!;
          m.carts = r.carts;
          log("prepare_checkout", { merchants: Object.keys(r.carts) });
          break;
        }
        default:
          throw new Error(`unknown action type ${body.type}`);
      }
    });
    return Response.json({ mission: m, totals: missionTotals(m), ...extra });
  } catch (e) {
    if (e instanceof NotFound) return Response.json({ error: e.message }, { status: 404 });
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
