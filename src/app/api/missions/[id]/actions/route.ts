/**
 * All mission mutations go through here, from the board (human) and from tools (agent).
 * Body: { actor, type, version?, ...fields }. Human actions may carry the version they were taken
 * against; a stale version is still applied but flagged so the agent's next mission_delta explains it.
 */
import { mutateMission, NotFound } from "@/lib/mission/repo";
import { planKit } from "@/lib/mission/planner";
import { searchForSlot } from "@/lib/mission/search";
import { prepareCheckout } from "@/lib/mission/checkout";
import { missionTotals, type Actor, type Mission, type Slot } from "@/lib/mission/types";

type Body = { actor?: Actor; type: string; version?: number; [k: string]: unknown };

function findSlot(m: Mission, id: unknown): Slot {
  const s = m.slots.find((x) => x.id === id);
  if (!s) throw new Error(`unknown slot_id ${String(id)}; slots: ${m.slots.map((x) => x.id).join(", ")}`);
  return s;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.type) return Response.json({ error: "type required" }, { status: 400 });
  const actor: Actor = body.actor === "human" ? "human" : "agent";
  const extra: Record<string, unknown> = {};

  try {
    const m = await mutateMission(id, async (m) => {
      const log = (type: string, detail?: unknown) =>
        m.events.push({ seq: (m.events.at(-1)?.seq ?? 0) + 1, at: new Date().toISOString(), actor, type, detail });
      const stale = typeof body.version === "number" && body.version !== m.version;

      switch (body.type) {
        case "set_budget": {
          const cents = Math.round(Number(body.budget_total_cents));
          if (!Number.isFinite(cents) || cents < 0) throw new Error("budget_total_cents must be a non-negative integer");
          m.budget_total_cents = cents;
          log("budget_changed", { budget_total_cents: cents, stale });
          break;
        }
        case "plan": {
          const style = (["minimal", "balanced", "premium"] as const).find((s) => s === body.style) ?? "balanced";
          const { notes, slots } = await planKit(m, style, req.signal);
          const locked = m.slots.filter((s) => s.locked);
          m.slots = [...locked, ...slots.filter((s) => !locked.some((l) => l.id === s.id))];
          extra.notes = notes;
          log("plan_kit", { style, slots: m.slots.map((s) => s.id) });
          break;
        }
        case "search": {
          const slot = findSlot(m, body.slot_id);
          const r = await searchForSlot(m, slot, {
            query: typeof body.query === "string" ? body.query : undefined,
            price_max_cents: typeof body.price_max_cents === "number" ? body.price_max_cents : undefined,
            merchant_domain: typeof body.merchant_domain === "string" ? body.merchant_domain : undefined,
            limit: typeof body.limit === "number" ? body.limit : undefined,
            signal: req.signal,
          });
          const existing = new Set(slot.candidates.map((c) => c.product_id));
          slot.candidates.push(...r.candidates.filter((c) => !existing.has(c.product_id)));
          extra.candidates = r.candidates;
          extra.sources = r.sources;
          if (r.errors.length) extra.errors = r.errors;
          log("search_products", { slot_id: slot.id, added: r.candidates.length });
          break;
        }
        case "choose": {
          const slot = findSlot(m, body.slot_id);
          if (slot.locked && actor === "agent") throw new Error(`slot ${slot.id} is locked by the person; ask before changing it`);
          const c = slot.candidates.find((x) => x.id === body.candidate_id);
          if (!c) throw new Error(`unknown candidate_id for slot ${slot.id}`);
          if (slot.rejected.some((r) => r.candidate_id === c.id) && actor === "agent") throw new Error(`candidate ${c.id} was rejected by the person`);
          slot.selected = c.id;
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
          if (slot.selected === cid) slot.selected = undefined;
          const c = slot.candidates.find((x) => x.id === cid);
          log("rejected", { slot_id: slot.id, candidate_id: cid, title: c?.title, reason: body.reason, stale });
          break;
        }
        case "prepare_checkout": {
          const r = await prepareCheckout(m, req.signal);
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
