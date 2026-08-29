/**
 * Day-0 verification probe. Re-runnable evidence for every external claim in the README:
 *   pnpm probe            → prints a table and writes evidence.json
 *
 * Checks:
 *   1. Global Catalog MCP answers a cross-merchant search without credentials.
 *   2. Each curated merchant's Storefront MCP lists tools and answers a search.
 *   3. (--carts) update_cart on one merchant returns a real cart id + checkout URL.
 */
import { writeFileSync } from "node:fs";
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
      if (withCarts && row.ok && r.products[0]?.variants?.[0]?.id) {
        const cart = await updateCart(m.domain, [{ product_variant_id: r.products[0].variants[0].id, quantity: 1 }]);
        const { cartId, checkoutUrl } = extractCart(cart);
        row.cart = { cart_id: cartId ? "present" : "missing", checkout_url: checkoutUrl ? "present" : "missing" };
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

  evidence.finished = new Date().toISOString();
  writeFileSync("evidence.json", JSON.stringify(evidence, null, 2));
  const gc = evidence.global_catalog as { ok: boolean; products?: number; distinct_sellers?: number; ms: number };
  console.log(`\nGlobal Catalog: ${gc.ok ? "OK" : "ERR"} ${gc.products ?? 0} products from ${gc.distinct_sellers ?? 0} sellers (${gc.ms} ms)`);
  console.log("wrote evidence.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
