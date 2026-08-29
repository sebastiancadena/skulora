/**
 * Brand assets and their acceptance check.
 *   pnpm brand          → writes public/logo.svg, public/logo-small.svg, public/logo-lockup.svg from src/lib/brand/Mark.tsx
 *   pnpm brand --check  → also fetches /icon, /apple-icon, /opengraph-image from BASE (default http://localhost:3123),
 *                         runs Lighthouse (accessibility, best-practices) and records everything under evidence.json → brand.
 * The mark's geometry lives only in Mark.tsx; nothing here is drawn by hand.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Mark } from "../src/lib/brand/Mark";
import { brand } from "../src/lib/brand/tokens";

const BASE = process.env.BASE ?? "http://localhost:3123";
const svg = (el: React.ReactElement) => `<?xml version="1.0" encoding="UTF-8"?>\n${renderToStaticMarkup(el)}\n`;

writeFileSync("public/logo.svg", svg(createElement(Mark, { px: 256 })));
writeFileSync("public/logo-small.svg", svg(createElement(Mark, { px: 64, size: "small" })));
const lockup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="272" height="64" viewBox="0 0 272 64" role="img" aria-label="Skulora Outfitter">
  ${renderToStaticMarkup(createElement(Mark, { px: 64 })).replace(/^<svg[^>]*>/, '<svg x="0" y="0" width="64" height="64" viewBox="0 0 64 64">')}
  <text x="80" y="36" font-family="Geist, Inter, system-ui, sans-serif" font-size="34" font-weight="600" letter-spacing="-0.5" fill="${brand.ink}">Skulora</text>
  <text x="81" y="56" font-family="'Geist Mono', ui-monospace, monospace" font-size="12" letter-spacing="3" fill="${brand.inkMuted}">OUTFITTER</text>
</svg>
`;
writeFileSync("public/logo-lockup.svg", lockup);
console.log("wrote public/logo.svg, logo-small.svg, logo-lockup.svg");

async function check() {
  const assets: Record<string, { status: number; type: string | null; bytes: number }> = {};
  for (const path of ["/icon", "/apple-icon", "/opengraph-image", "/logo.svg", "/logo-lockup.svg"]) {
    const r = await fetch(BASE + path);
    assets[path] = { status: r.status, type: r.headers.get("content-type"), bytes: (await r.arrayBuffer()).byteLength };
  }
  const out = ".scratch/lighthouse.json";
  execFileSync("pnpm", ["dlx", "lighthouse", BASE + "/", "--quiet", "--only-categories=accessibility,best-practices,performance", "--chrome-flags=--headless=new --no-sandbox", "--output=json", `--output-path=${out}`], { stdio: "inherit" });
  const lh = JSON.parse(readFileSync(out, "utf8"));
  const scores = Object.fromEntries(Object.entries(lh.categories as Record<string, { score: number }>).map(([k, v]) => [k, Math.round(v.score * 100)]));
  const evidence = existsSync("evidence.json") ? JSON.parse(readFileSync("evidence.json", "utf8")) : {};
  evidence.brand = { checked_at: new Date().toISOString(), base: BASE, assets, lighthouse: scores, lighthouse_version: lh.lighthouseVersion };
  writeFileSync("evidence.json", JSON.stringify(evidence, null, 2));
  console.table(assets);
  console.log("lighthouse", scores, "→ evidence.json.brand");
  const ok = Object.values(assets).every((a) => a.status === 200) && scores.accessibility >= 95;
  if (!ok) process.exit(1);
}

if (process.argv.includes("--check")) void check();