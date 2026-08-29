/**
 * G1 harness: run canned missions through the planner and per-slot search, server-side, no browser.
 *   pnpm harness            → all missions, prints slots + top candidates + timings, writes harness.json
 *   pnpm harness 2          → only mission #2
 * Requires OPENAI_API_KEY in .env.local (loaded here).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { planKit } from "../src/lib/mission/planner";
import { searchForSlot } from "../src/lib/mission/search";
import { explainableSlots, explainTradeoffs } from "../src/lib/mission/tradeoffs";
import { missionTotals, type Mission } from "../src/lib/mission/types";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

const MISSIONS = [
  { goal: "3-day desert backpacking trip", budget_total_cents: 60000, owned_items: ["stove", "headlamp"], constraints: ["runs hot at night"] },
  { goal: "first apartment kitchen, cooking for two", budget_total_cents: 40000, owned_items: [], constraints: ["small kitchen", "induction stove"] },
  { goal: "start running 5k three times a week", budget_total_cents: 25000, owned_items: [], constraints: ["flat feet", "rainy city"] },
  { goal: "home espresso setup for milk drinks", budget_total_cents: 50000, owned_items: ["scale"], constraints: ["quiet", "small counter"] },
  { goal: "weekend car camping with two kids", budget_total_cents: 45000, owned_items: ["tent"], constraints: ["cold nights"] },
  { goal: "capsule hiking wardrobe for a week in Patagonia", budget_total_cents: 70000, owned_items: ["boots"], constraints: ["wind and rain", "merino preferred"] },
];

const only = process.argv[2] ? Number(process.argv[2]) - 1 : null;
const report: unknown[] = [];

async function run(i: number) {
  const spec = MISSIONS[i];
  const now = new Date().toISOString();
  const m: Mission = { id: `h_${i + 1}`, version: 1, created_at: now, updated_at: now, currency: "USD", slots: [], carts: {}, events: [], ...spec };
  const t0 = performance.now();
  const plan = await planKit(m);
  const planMs = Math.round(performance.now() - t0);
  m.slots = plan.slots;
  console.log(`\n=== #${i + 1} ${m.goal} — plan ${planMs} ms, ${m.slots.length} slots`);
  console.log(`    ${plan.notes}`);
  const slotReports = [];
  for (const s of m.slots) {
    const t1 = performance.now();
    const r = await searchForSlot(m, s, { limit: 4 });
    const ms = Math.round(performance.now() - t1);
    s.candidates = r.candidates;
    const top = r.candidates[0];
    if (top) s.selected = top.id;
    console.log(`  - ${s.need.padEnd(34)} ${s.required ? "req" : "opt"} ≈$${((s.budget_hint_cents ?? 0) / 100).toFixed(0).padStart(4)}  q="${s.search_query}"  ${ms} ms  ${r.candidates.length} cands from [${r.sources.join(",")}]${r.errors.length ? "  ERR " + r.errors.join(" | ") : ""}`);
    for (const c of r.candidates.slice(0, 2)) console.log(`      · $${(c.price_cents / 100).toFixed(2)} ${c.title.slice(0, 50)} @ ${c.merchant_domain} — ${c.why_it_fits.join("; ")}`);
    slotReports.push({ slot: s.id, ms, candidates: r.candidates.length, sources: r.sources, errors: r.errors });
  }
  const t = missionTotals(m);
  console.log(`  total (top pick per slot): $${(t.selected_cents / 100).toFixed(2)} of $${((m.budget_total_cents ?? 0) / 100).toFixed(0)} across ${t.merchants} merchants${t.over_budget ? "  OVER BUDGET" : ""}`);
  // explain_tradeoffs over every selected slot: must reference only real candidate ids and fit a tool result.
  const t2 = performance.now();
  const tr = await explainTradeoffs(m, explainableSlots(m));
  const explainMs = Math.round(performance.now() - t2);
  const toolResult = JSON.stringify(Object.entries(tr).map(([slot_id, x]) => ({ slot_id, chosen_because: x.chosen_because, budget_note: x.budget_note }))); // all-slots tool result shape
  const fullBytes = JSON.stringify(tr).length;
  const badIds = Object.entries(tr).flatMap(([sid, x]) => x.vs_alternatives.filter((a) => !m.slots.find((s) => s.id === sid)?.candidates.some((c) => c.id === a.candidate_id)).map((a) => a.candidate_id));
  console.log(`  explain_tradeoffs: ${Object.keys(tr).length}/${Math.min(6, m.slots.filter((s) => s.selected).length)} slots, ${explainMs} ms, ${toolResult.length} bytes (tool result), ${fullBytes} on board${badIds.length ? "  BAD IDS " + badIds.join(",") : ""}`);
  for (const [sid, x] of Object.entries(tr).slice(0, 2)) console.log(`      · ${sid}: ${x.chosen_because}`);
  report.push({ mission: m.goal, planMs, slots: slotReports, totals: t, explain: { ms: explainMs, slots: Object.keys(tr).length, bytes: toolResult.length, boardBytes: fullBytes, badIds } });
}

(async () => {
  const idx = only == null ? MISSIONS.map((_, i) => i) : [only];
  for (const i of idx) await run(i);
  writeFileSync("harness.json", JSON.stringify(report, null, 2));
  console.log("\nwrote harness.json");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
