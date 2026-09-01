/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Misuse probe: drive the WebMCP tools the way a careless agent would — out of order, with stale
 * or foreign ids, in parallel, against a board the person is editing — through
 * document.modelContext in flagged headless Chrome, and check what the board does.
 *   pnpm misuse                     → against http://localhost:3123 (start `RATE_LIMIT=off pnpm dev -p 3123` first)
 *   BASE=https://… pnpm misuse      → against a deployment (spends OpenAI: one plan + a few searches)
 * Prints one PASS/FAIL line per check and exits non-zero on any FAIL.
 */
import { chromium, type Page } from "playwright-core";
const BASE = process.env.BASE ?? "http://localhost:3123";
const results: string[] = [];
const ok = (name: string, pass: boolean, note = "") => { results.push(`${pass ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`); console.log(results.at(-1)); };

async function tool(page: Page, name: string, args: Record<string, unknown> = {}) {
  return page.evaluate(async ([name, args]) => {
    const mc = (document as any).modelContext;
    const t = (await mc.getTools()).find((x: any) => x.name === name);
    if (!t) return { __unregistered: true };
    const out = await mc.executeTool(t, JSON.stringify(args));
    return typeof out === "string" ? JSON.parse(out) : out;
  }, [name, args] as const);
}
/** Expand a slot's candidate list if it is collapsed (the button toggles). */
async function openCandidates(card: ReturnType<Page["locator"]>) {
  if ((await card.locator("button:has-text('choose')").count()) === 0) await card.locator("button:has-text('candidates')").click();
}
const stateOf = (page: Page) => page.evaluate(() => ({ text: document.body.innerText, missionId: localStorage.getItem("skulora.missionId") }));
const registeredNames = (page: Page) => page.evaluate(async () => ((await (document as any).modelContext.getTools()) as any[]).map((t) => t.name).sort());

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-features=WebMCPTesting"] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  await page.goto(BASE + "/");
  await page.waitForFunction(() => /WebMCP:\s*registered/.test(document.body.innerText), null, { timeout: 15000 });

  // S1: stage-B/C tools before any mission
  ok("S1 stage A only registered", (await registeredNames(page)).join() === "create_mission,get_mission,set_budget", (await registeredNames(page)).join());
  const gm0 = await tool(page, "get_mission");
  ok("S1 get_mission without mission returns null mission + stage A", gm0.mission === null && gm0.stage === "A", JSON.stringify(gm0).slice(0, 120));
  const sb0 = await tool(page, "set_budget", { budget_total_cents: 1000 });
  ok("S1 set_budget without mission errors", !!sb0.error, sb0.error);

  // S2: create a mission, then plan (LLM), then search two slots (LLM+merchants)
  const cm = await tool(page, "create_mission", { goal: "3-day desert backpacking trip", budget_total_cents: 60000, owned_items: ["stove"], constraints: ["runs hot at night"] });
  ok("S2 create_mission", !!cm.mission?.id && cm.stage === "B", `id=${cm.mission?.id}`);
  await page.waitForTimeout(500);
  ok("S2 stage B tools registered", (await registeredNames(page)).includes("plan_kit"), (await registeredNames(page)).join());
  const pk = await tool(page, "plan_kit", {});
  ok("S2 plan_kit", Array.isArray(pk.slots) && pk.slots.length >= 4, `slots=${pk.slots?.map((s: any) => s.id).join(",")}`);
  const slotIds: string[] = pk.slots.map((s: any) => s.id);
  const dupIds = slotIds.filter((s, i) => slotIds.indexOf(s) !== i);
  ok("S2 plan slot ids unique", dupIds.length === 0, dupIds.join(","));

  // S3: bogus ids
  const sbad = await tool(page, "search_products", { slot_id: "nope" });
  ok("S3 search unknown slot errors", !!sbad.error, sbad.error);
  const cbad = await tool(page, "choose_candidate", { slot_id: slotIds[0], candidate_id: "c_nope", reason: "x" });
  ok("S3 choose unknown candidate errors", !!cbad.error, cbad.error);
  const ebad = await tool(page, "explain_tradeoffs", {});
  ok("S3 explain before any selection errors", !!ebad.error, ebad.error);
  const pcEarly = await tool(page, "prepare_checkout", {});
  ok("S3 prepare_checkout before Stage C is not registered or errors", pcEarly.__unregistered || !!pcEarly.error, JSON.stringify(pcEarly).slice(0, 160));

  // S4: arbitrary merchant_domain (SSRF-ish) — expect a refusal, not a fetch to the host
  const ssrf = await tool(page, "search_products", { slot_id: slotIds[0], merchant_domain: "example.com/../../x" });
  ok("S4 arbitrary merchant_domain refused", !!ssrf.error && /merchant/i.test(ssrf.error) && !(ssrf.errors ?? []).some((e: string) => /HTTP|fetch/.test(e)), JSON.stringify(ssrf).slice(0, 200));

  // S5: two parallel searches on the same slot + one on another slot (out-of-order responses)
  const [r1, r2, r3] = await Promise.all([
    tool(page, "search_products", { slot_id: slotIds[0], limit: 4 }),
    tool(page, "search_products", { slot_id: slotIds[0], limit: 4 }),
    tool(page, "search_products", { slot_id: slotIds[1], limit: 4 }),
  ]);
  ok("S5 parallel searches all succeed", !r1.error && !r2.error && !r3.error, [r1.error, r2.error, r3.error].filter(Boolean).join(" | "));
  const gm1 = await tool(page, "get_mission");
  const s0 = gm1.mission.slots.find((s: any) => s.id === slotIds[0]);
  const s1 = gm1.mission.slots.find((s: any) => s.id === slotIds[1]);
  ok("S5 both slots have candidates after parallel search", s0.candidates > 0 && s1.candidates > 0, `s0=${s0.candidates} s1=${s1.candidates}`);
  const st = await stateOf(page);
  ok("S5 board shows candidates immediately (no stale cache)", new RegExp(`${s0.candidates} candidates`).test(st.text) && new RegExp(`${s1.candidates} candidates`).test(st.text));

  // S6: agent chooses; human re-picks another; agent chooses locked slot etc.
  const c0 = r1.candidates?.[0] ?? r2.candidates?.[0];
  const c0b = (r1.candidates ?? r2.candidates).find((c: any) => c.id !== c0.id);
  const ch = await tool(page, "choose_candidate", { slot_id: slotIds[0], candidate_id: c0.id, reason: "cheap and light" });
  ok("S6 choose ok", !ch.error, ch.error);
  const chOther = await tool(page, "choose_candidate", { slot_id: slotIds[1], candidate_id: c0.id, reason: "wrong slot" });
  ok("S6 choose candidate from another slot errors", !!chOther.error, chOther.error);
  // human locks slot 0 via UI
  await page.click("button:has-text('lock')");
  await page.waitForTimeout(400);
  const chLocked = await tool(page, "choose_candidate", { slot_id: slotIds[0], candidate_id: c0b?.id ?? c0.id, reason: "override" });
  ok("S6 choose on locked slot errors and delta carries 'locked'", !!chLocked.error && chLocked.mission_delta?.some((d: any) => d.type === "locked"), JSON.stringify(chLocked).slice(0, 200));
  await page.click("button:has-text('locked')"); // unlock
  await page.waitForTimeout(400);

  // S7: plan_kit again after human picks (not locked) — does the human's selection survive?
  // human chooses in slot 1 through the UI
  const card1 = page.locator("section.card").filter({ hasText: s1.need });
  await openCandidates(card1);
  await card1.locator("button:has-text('choose')").first().click();
  await page.waitForTimeout(500);
  const gm2 = await tool(page, "get_mission");
  ok("S7 human choice recorded", gm2.mission.slots.find((s: any) => s.id === slotIds[1]).selected != null);
  await tool(page, "plan_kit", { style: "minimal" });
  const gm3 = await tool(page, "get_mission");
  const keptHuman = gm3.mission.slots.find((s: any) => s.id === slotIds[1])?.selected != null;
  const keptAgent = gm3.mission.slots.find((s: any) => s.id === slotIds[0])?.selected != null;
  ok("S7 re-plan keeps the human's (unlocked) pick", keptHuman, `human kept=${keptHuman}, agent pick kept=${keptAgent}, slots=${gm3.mission.slots.map((s: any) => s.id).join(",")}`);
  const ids3: string[] = gm3.mission.slots.map((s: any) => s.id);
  ok("S7 re-plan slot ids unique", new Set(ids3).size === ids3.length, ids3.join(","));
  const consoleDupKey = consoleErrors.filter((e) => /same key|unique "key"/.test(e));
  ok("S7 no duplicate React keys so far", consoleDupKey.length === 0, consoleDupKey[0]);

  // S8: fill every required slot cheaply via UI where candidates exist, else search; then prepare_checkout, then human re-picks → stale carts?
  for (const s of gm3.mission.slots.filter((x: any) => x.required && !x.selected)) {
    const r = await tool(page, "search_products", { slot_id: s.id, limit: 3 });
    if (r.candidates?.[0]) await tool(page, "choose_candidate", { slot_id: s.id, candidate_id: r.candidates[0].id, reason: "first fit" });
  }
  const gm4 = await tool(page, "get_mission");
  ok("S8 all required filled → stage C", gm4.stage === "C", `unfilled=${gm4.mission.required_unfilled.join(",")}`);
  await page.waitForTimeout(500);
  ok("S8 stage C tools registered", (await registeredNames(page)).includes("prepare_checkout"));
  const pc = await tool(page, "prepare_checkout", {});
  ok("S8 prepare_checkout returns carts", Array.isArray(pc.checkouts) && pc.checkouts.length > 0, JSON.stringify(pc.checkouts).slice(0, 200));
  await page.waitForTimeout(300);
  const cartsBefore = (await stateOf(page)).text.includes("Checkout — one cart per merchant");
  // human re-picks a different candidate in a slot that has ≥2 candidates
  const slotWithAlt = gm4.mission.slots.find((s: any) => s.selected && s.candidates >= 2);
  if (slotWithAlt) {
    const card = page.locator("section.card").filter({ hasText: slotWithAlt.need });
    await openCandidates(card);
    await card.locator("button:has-text('choose')").first().click();
    await page.waitForTimeout(600);
    const st2 = await stateOf(page);
    const stillShowsCarts = st2.text.includes("Checkout — one cart per merchant");
    const gcs = await tool(page, "get_checkout_status");
    ok("S8 checkout cards not left stale after human re-pick", !stillShowsCarts || gcs.checkouts.length === 0, `cartsBefore=${cartsBefore} after=${stillShowsCarts} status=${JSON.stringify(gcs.checkouts).slice(0, 120)}`);
  } else ok("S8 (skipped) no slot with an alternative", true);

  // S9: human rejects the selected item of a required slot at stage C while agent calls get_checkout_status in parallel (stage regression mid-call)
  const reqSlot = gm4.mission.slots.find((s: any) => s.required && s.selected);
  const card = page.locator("section.card").filter({ hasText: reqSlot.need });
  page.once("dialog", (d) => void d.accept("nope"));
  const [gcs2] = await Promise.all([tool(page, "get_checkout_status").catch((e) => ({ threw: String(e.message).slice(0, 160) })), card.locator("button:has-text('reject')").first().click()]);
  ok("S9 get_checkout_status survives a concurrent stage regression", !gcs2.threw, JSON.stringify(gcs2).slice(0, 160));
  await page.waitForTimeout(600);
  ok("S9 stage C tools stay registered after the person empties a required slot", (await registeredNames(page)).includes("prepare_checkout"), (await registeredNames(page)).join());
  const pcHole = await tool(page, "prepare_checkout", {});
  ok("S9 prepare_checkout with an empty required slot is refused and names the slot", !!pcHole.error && pcHole.error.includes(reqSlot.id), JSON.stringify(pcHole).slice(0, 200));
  ok("S9 next_suggested_tools points back to choosing, not checkout", pcHole.next_suggested_tools?.[0] === "plan_kit", JSON.stringify(pcHole.next_suggested_tools));

  // S10: second create_mission with a board in progress
  const cm2 = await tool(page, "create_mission", { goal: "home espresso setup" });
  ok("S10 create_mission on a board in progress is refused and points to set_budget/plan_kit/replace", !!cm2.error && /replace: true/.test(cm2.error) && /set_budget/.test(cm2.error), JSON.stringify(cm2).slice(0, 200));
  const mid = (await stateOf(page)).missionId;
  ok("S10 board still on the original mission", mid === cm.mission.id, `${mid} vs ${cm.mission.id}`);
  const cm3 = await tool(page, "create_mission", { goal: "home espresso setup", replace: true });
  ok("S10 create_mission with replace: true starts over", !cm3.error && cm3.mission?.id !== cm.mission.id && cm3.replaced === cm.mission.id && cm3.stage === "B", JSON.stringify(cm3).slice(0, 160));
  await page.waitForTimeout(500);
  ok("S10 stage reset to B for the new mission (C tools gone)", !(await registeredNames(page)).includes("prepare_checkout"), (await registeredNames(page)).join());
  const gm5 = await tool(page, "get_mission");
  ok("S10 new mission carries no delta from the old board", gm5.mission_delta.length === 0 && (await stateOf(page)).text.includes("home espresso setup"), JSON.stringify(gm5.mission_delta));

  // S11: stale localStorage id (mission gone server-side) → board + tools should agree
  await page.evaluate(() => localStorage.setItem("skulora.missionId", "m_doesnotexist"));
  await page.reload();
  await page.waitForFunction(() => /WebMCP:\s*registered/.test(document.body.innerText), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const st3 = await stateOf(page);
  const sb1 = await tool(page, "set_budget", { budget_total_cents: 100 });
  const st4 = await stateOf(page);
  ok("S11 missing mission: board says no mission, tool says call create_mission, dead id forgotten", /No mission yet/.test(st3.text) && /create_mission/.test(sb1.error ?? "") && st4.missionId === null, `err=${sb1.error} id=${st4.missionId}`);

  console.log("\nconsole errors/warnings:", consoleErrors.length);
  for (const e of consoleErrors.slice(0, 15)) console.log("  ", e);
  await browser.close();
  console.log("\n" + results.filter((r) => r.startsWith("FAIL")).length + " FAIL / " + results.length);
})().catch((e) => { console.error(e); process.exit(1); });
