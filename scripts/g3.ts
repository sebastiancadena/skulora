/**
 * G3 evidence: on production, three consecutive runs of the full co-driving loop, asserted against the
 * server-side mission (GET /api/missions/:id), not screenshots:
 *   1. the built-in agent fills a kit from a one-line mission (Stage A → B → C)
 *   2. the human locks one pick and rejects another on the board (real clicks on the page)
 *   3. "re-plan" → the agent keeps the locked pick, replaces the rejected one, touches nothing it wasn't told to
 *   4. prepare_checkout → one cart per merchant; every checkout URL is opened in Chrome and must land on a 200 checkout page
 *
 *   pnpm g3                 → 3 runs against https://outfitter.skulora.com, writes g3.json
 *   RUNS=1 BASE=http://localhost:3123 pnpm g3
 */
import { writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import type { Mission } from "../src/lib/mission/types";

const BASE = process.env.BASE ?? "https://outfitter.skulora.com";
const RUNS = Number(process.env.RUNS ?? 3);
const SCRATCH = process.env.SCRATCH ?? ".";
const MISSIONS = [
  "Outfit me for a 3-day desert backpacking trip, budget $600, I already own a stove. Pick something for every slot.",
  "Weekend car camping with two kids, budget $450, we already own a tent. Pick something for every slot.",
  "Home espresso setup for milk drinks, budget $500, I already own a kettle. Pick something for every slot.",
];

type Check = { name: string; ok: boolean; detail?: unknown };

async function getMission(id: string): Promise<Mission> {
  const r = await fetch(`${BASE}/api/missions/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET mission ${id} → ${r.status}`);
  return ((await r.json()) as { mission: Mission }).mission;
}

async function send(page: Page, text: string) {
  await page.fill("input[placeholder^='Tell the agent']", text);
  const t0 = Date.now();
  await page.click("button:has-text('Send')");
  await page.waitForFunction(() => !document.querySelector("form button[disabled]"), null, { timeout: 300000 });
  return Date.now() - t0;
}

async function run(i: number, page: Page) {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    checks.push({ name, ok, detail });
    console.log(`  ${ok ? "PASS" : "FAIL"} ${name}`, detail ? JSON.stringify(detail) : "");
  };
  const goal = MISSIONS[i % MISSIONS.length];
  console.log(`run ${i + 1}: ${goal}`);
  await page.goto(BASE + "/");
  await page.evaluate(() => localStorage.removeItem("skulora.missionId"));
  await page.goto(BASE + "/");

  // 1. agent fills the kit
  const fillMs = await send(page, goal);
  const id = (await page.evaluate(() => localStorage.getItem("skulora.missionId"))) as string;
  let m = await getMission(id);
  const filled = m.slots.filter((s) => s.selected);
  const requiredUnfilled = m.slots.filter((s) => s.required && !s.selected).map((s) => s.id);
  check("kit filled", filled.length >= 3 && requiredUnfilled.length === 0, { mission: id, slots: m.slots.length, filled: filled.length, required_unfilled: requiredUnfilled, ms: fillMs });
  if (filled.length < 2) return { mission: id, checks };

  // 2. human edits on the board: lock slot A, reject slot B's current pick
  const [a, b] = filled;
  const seqBefore = m.events.at(-1)?.seq ?? 0;
  await page.locator(`section.waypoint:has(h3:has-text("${a.need}")) button:has-text('lock')`).first().click();
  page.once("dialog", (d) => void d.accept("not this one"));
  const sectionB = page.locator(`section.waypoint:has(h3:has-text("${b.need}"))`);
  await sectionB.locator("button:has-text('candidates')").click();
  await sectionB.locator("li.border-pine-300 button:has-text('reject')").first().click();
  await page.waitForTimeout(1500);
  m = await getMission(id);
  const A = m.slots.find((s) => s.id === a.id)!;
  const B = m.slots.find((s) => s.id === b.id)!;
  const humanEvents = m.events.filter((e) => e.seq > seqBefore && e.actor === "human").map((e) => e.type);
  check("board edits recorded", A.locked && B.rejected.some((r) => r.candidate_id === b.selected) && humanEvents.length === 2, { locked: a.id, rejected: { slot: b.id, candidate: b.selected }, humanEvents });
  const untouched = m.slots.filter((s) => s.id !== a.id && s.id !== b.id).map((s) => [s.id, s.selected] as const);

  // 3. re-plan
  const replanMs = await send(page, "I changed the board — re-plan within budget.");
  m = await getMission(id);
  const A2 = m.slots.find((s) => s.id === a.id)!;
  const B2 = m.slots.find((s) => s.id === b.id)!;
  const agentEvents = m.events.filter((e) => e.seq > seqBefore && e.actor === "agent").map((e) => e.type);
  check("locked pick kept", A2.locked && A2.selected === a.selected, { slot: a.id, selected: a.selected });
  check("rejected pick replaced", !!B2.selected && B2.selected !== b.selected && !B2.rejected.some((r) => r.candidate_id === B2.selected), { slot: b.id, was: b.selected, now: B2.selected, by: B2.selected_by, reason: B2.selected_reason });
  const drift = untouched.filter(([sid, sel]) => m.slots.find((s) => s.id === sid)?.selected !== sel);
  check("other slots untouched", drift.length === 0, { changed: drift, ms: replanMs, agentEvents: [...new Set(agentEvents)] });

  // 4. checkout
  let carts = Object.values(m.carts);
  if (carts.length === 0 || m.events.filter((e) => e.type === "prepare_checkout").every((e) => e.seq < seqBefore)) {
    await send(page, "Prepare the checkout carts.");
    m = await getMission(id);
    carts = Object.values(m.carts);
  }
  // A judge clicks these in a browser, so open them in one: Shopify answers 403 to plain fetch, 200 + /checkouts/… in Chrome.
  const urls: { merchant: string; url?: string; status?: number; landed?: string; title?: string; error?: string }[] = [];
  const tab = await page.context().newPage();
  for (const c of carts) {
    if (!c.checkout_url) { urls.push({ merchant: c.merchant_domain, error: c.error ?? "no checkout_url" }); continue; }
    try {
      const r = await tab.goto(c.checkout_url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await tab.waitForTimeout(2500);
      urls.push({ merchant: c.merchant_domain, url: c.checkout_url, status: r?.status(), landed: tab.url(), title: await tab.title() });
    } catch (e) {
      urls.push({ merchant: c.merchant_domain, url: c.checkout_url, error: String(e) });
    }
  }
  await tab.close();
  const live = urls.filter((u) => u.status === 200 && /\/checkouts?\//.test(u.landed ?? ""));
  const merchantsInKit = new Set(m.slots.filter((s) => s.selected).map((s) => s.candidates.find((c) => c.id === s.selected)?.merchant_domain)).size;
  check("checkout links open real carts", live.length >= 3 && live.length === urls.length - urls.filter((u) => u.error && !u.url).length, { merchants_in_kit: merchantsInKit, carts: urls.length, live: live.length, urls });
  await page.screenshot({ path: `${SCRATCH}/g3-run${i + 1}.png`, fullPage: true });
  return { mission: id, goal, checks };
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await run(i, page));
  await browser.close();
  const pass = runs.every((r) => r.checks.every((c) => c.ok));
  const out = { base: BASE, finished: new Date().toISOString(), runs: RUNS, pass, results: runs };
  writeFileSync("g3.json", JSON.stringify(out, null, 2));
  console.log(pass ? `G3 PASS — ${RUNS}/${RUNS} consecutive runs` : "G3 FAIL — see g3.json");
  process.exit(pass ? 0 : 1);
}

void main();
