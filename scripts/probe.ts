/**
 * Day-0 verification probe. Re-runnable evidence for every external claim in the README:
 *   pnpm probe            → prints a table and writes evidence.json
 *
 * Checks:
 *   1. Global Catalog MCP answers a cross-merchant search without credentials.
 *   2. Each curated merchant's Storefront MCP lists tools and answers a search.
 *   3. (--carts) update_cart on one merchant returns a real cart id + checkout URL.
 *   4. (--burst) per-IP rate limit on BASE (default https://outfitter.skulora.com): 30 invalid POSTs to
 *      /api/missions in a burst must turn into 429 after the configured limit (20/min); nothing is created.
 *      It spends this machine's own 60 s window — wait a minute before driving the agent from the same IP.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  GLOBAL_CATALOG_URL,
  extractCart,
  listTools,
  searchGlobalCatalog,
  searchStoreCatalog,
  storefrontUrl,
  updateCart,
} from "../src/lib/shopify/mcp";
import merchants from "../src/lib/shopify/merchants.json" with { type: "json" };

let withCarts = process.argv.includes("--carts");
const withBurst = process.argv.includes("--burst");
const BASE = process.env.BASE ?? "https://outfitter.skulora.com";
const started = new Date().toISOString();
const evidence: Record<string, unknown> = { started, global_catalog: {}, merchants: [] as unknown[] };

function ms(t0: number) {
  return Math.round(performance.now() - t0);
}

async function main() {
  // 1. Global catalog
  {
    const t0 = performance.now();
    try {
      const r = await searchGlobalCatalog("quiet espresso grinder", { price: { max: 30000 } });
      const sellers = new Set(r.products.map((p) => p.seller?.domain ?? p.seller?.name ?? "?"));
      evidence.global_catalog = {
        endpoint: GLOBAL_CATALOG_URL,
        ok: r.products.length > 0,
        products: r.products.length,
        distinct_sellers: sellers.size,
        sample: r.products.slice(0, 3).map((p) => ({ title: p.title, seller: p.seller?.name, min: p.price_range?.min })),
        ms: ms(t0),
      };
    } catch (e) {
      evidence.global_catalog = { endpoint: GLOBAL_CATALOG_URL, ok: false, error: String(e), ms: ms(t0) };
    }
  }

  // 2. Merchants
  for (const m of merchants as { domain: string; tags: string[]; probe_query: string }[]) {
    const t0 = performance.now();
    const row: Record<string, unknown> = { domain: m.domain, endpoint: storefrontUrl(m.domain), tags: m.tags };
    try {
      row.tools = await listTools(storefrontUrl(m.domain));
      const r = await searchStoreCatalog(m.domain, m.probe_query);
      row.search_products = r.products.length;
      row.sample = r.products[0] ? { title: r.products[0].title, min: r.products[0].price_range?.min } : null;
      row.ok = (row.tools as string[]).includes("update_cart") && r.products.length > 0;
      const variant = r.products.flatMap((p) => p.variants ?? []).find((v) => v.availability?.available);
      if (withCarts && row.ok && variant) {
        const cart = await updateCart(m.domain, [{ product_variant_id: variant.id, quantity: 1 }]);
        const { cartId, checkoutUrl } = extractCart(cart);
        row.cart = { cart_id: cartId ? "present" : "missing", checkout_url: checkoutUrl ? "present" : "missing" }; // errors ignored in probe
        withCarts = false; // one real cart is enough evidence
      }
    } catch (e) {
      row.ok = false;
      row.error = String(e);
    }
    row.ms = ms(t0);
    (evidence.merchants as unknown[]).push(row);
    console.log(`${row.ok ? "OK " : "ERR"} ${m.domain.padEnd(28)} ${String(row.ms).padStart(6)} ms  ${row.error ?? `${row.search_products} products, tools=${(row.tools as string[])?.length ?? 0}`}`);
  }

  if (withBurst) {
    const t0 = performance.now();
    const N = 30;
    const statuses = await Promise.all(
      Array.from({ length: N }, () => fetch(`${BASE}/api/missions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status)),
    );
    const rejected = statuses.filter((s) => s === 429).length;
    const first429 = statuses.indexOf(429);
    // Reads must never be limited, even mid-burst.
    const read = await fetch(`${BASE}/api/missions/m_does_not_exist`).then((r) => r.status);
    evidence.burst = { base: BASE, endpoint: "/api/missions", requests: N, limit_per_min: 20, rejected_429: rejected, first_429_at: first429 + 1, read_during_burst_status: read, ok: rejected > 0 && rejected >= N - 20 - 1 && read === 404, ms: ms(t0) };
    console.log(`burst: ${N} POSTs → ${rejected} × 429 (first at #${first429 + 1}), GET during burst → ${read}${(evidence.burst as { ok: boolean }).ok ? "  OK" : "  ERR"}`);
  }

  evidence.finished = new Date().toISOString();
  // Keep the brand check (pnpm brand --check) alongside the merchant probe.
  const prev = existsSync("evidence.json") ? JSON.parse(readFileSync("evidence.json", "utf8")) : {};
  if (prev.brand) (evidence as Record<string, unknown>).brand = prev.brand;
  writeFileSync("evidence.json", JSON.stringify(evidence, null, 2));
  const gc = evidence.global_catalog as { ok: boolean; products?: number; distinct_sellers?: number; ms: number };
  console.log(`\nGlobal Catalog: ${gc.ok ? "OK" : "ERR"} ${gc.products ?? 0} products from ${gc.distinct_sellers ?? 0} sellers (${gc.ms} ms)`);
  console.log("wrote evidence.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
