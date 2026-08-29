import { putMission, repoKind } from "@/lib/mission/repo";
import { newId, type Mission } from "@/lib/mission/types";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<Mission> & { goal?: string };
  if (!body.goal || typeof body.goal !== "string") return Response.json({ error: "goal required" }, { status: 400 });
  const now = new Date().toISOString();
  const m: Mission = {
    id: newId("m"),
    version: 1,
    created_at: now,
    updated_at: now,
    goal: body.goal.slice(0, 300),
    budget_total_cents: typeof body.budget_total_cents === "number" && body.budget_total_cents >= 0 ? Math.round(body.budget_total_cents) : undefined,
    currency: typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency) ? body.currency : "USD",
    owned_items: Array.isArray(body.owned_items) ? body.owned_items.map(String).slice(0, 20) : [],
    constraints: Array.isArray(body.constraints) ? body.constraints.map(String).slice(0, 20) : [],
    slots: [],
    carts: {},
    events: [{ seq: 1, at: now, actor: "agent", type: "create_mission" }],
  };
  await putMission(m);
  return Response.json({ mission: m, storage: repoKind() });
}
