/**
 * Minimal JSON-RPC client for Shopify's public MCP endpoints.
 *
 *  - Global Catalog MCP:  https://catalog.shopify.com/api/ucp/mcp   (cross-merchant discovery)
 *  - Storefront MCP:      https://{merchant}/api/mcp                (per-store detail + carts)
 *
 * Both are unauthenticated (verified 2026-08-29). Every request carries a UCP agent profile.
 * Runs on the server only — never call merchants from the browser.
 */

export const GLOBAL_CATALOG_URL = "https://catalog.shopify.com/api/ucp/mcp";
export const DEFAULT_AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json";

type JsonRpcResult = {
  jsonrpc: "2.0";
  id: number;
  result?: { content?: { type: string; text?: string }[]; structuredContent?: unknown; tools?: unknown[] };
  error?: { code: number; message: string };
};

export class McpError extends Error {
  constructor(message: string, readonly endpoint: string, readonly status?: number) {
    super(message);
  }
}

const UCP_CATALOG_TOOLS = new Set(["search_catalog", "lookup_catalog", "get_product"]);

let nextId = 1;

async function rpc(endpoint: string, method: string, params: unknown, signal?: AbortSignal, timeoutMs = 12_000) {
  try {
    return await rpcOnce(endpoint, method, params, signal, timeoutMs);
  } catch (e) {
    // One retry on transient network failures (DNS/connection resets seen on some merchants); never on HTTP errors.
    if (e instanceof McpError || signal?.aborted) throw e;
    return rpcOnce(endpoint, method, params, signal, timeoutMs);
  }
}

async function rpcOnce(endpoint: string, method: string, params: unknown, signal?: AbortSignal, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new McpError(`HTTP ${res.status}`, endpoint, res.status);
    const json = (await res.json()) as JsonRpcResult;
    if (json.error) throw new McpError(json.error.message, endpoint);
    return json.result ?? {};
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a tools/call result: prefer structuredContent, else the first text block as JSON. */
function parseCallResult<T>(result: NonNullable<JsonRpcResult["result"]>): T {
  if (result.structuredContent !== undefined) return result.structuredContent as T;
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("empty MCP result");
  try {
    return JSON.parse(text) as T;
  } catch {
    return { text } as unknown as T;
  }
}

export function storefrontUrl(merchantDomain: string) {
  return `https://${merchantDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}/api/mcp`;
}

export async function listTools(endpoint: string, signal?: AbortSignal): Promise<string[]> {
  const r = await rpc(endpoint, "tools/list", {}, signal);
  return ((r.tools ?? []) as { name: string }[]).map((t) => t.name);
}

export async function callTool<T = unknown>(
  endpoint: string,
  name: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal; agentProfile?: string } = {},
): Promise<T> {
  const profile = opts.agentProfile ?? process.env.SHOPIFY_UCP_AGENT_PROFILE ?? DEFAULT_AGENT_PROFILE;
  // Only the UCP catalog tools accept (and require) the agent-profile meta; cart/policy tools reject it.
  const meta = UCP_CATALOG_TOOLS.has(name) ? { meta: { "ucp-agent": { profile } } } : {};
  const r = await rpc(endpoint, "tools/call", { name, arguments: { ...meta, ...args } }, opts.signal);
  return parseCallResult<T>(r);
}

// ---- Typed conveniences over the UCP catalog shapes we actually use --------------------------

export type UcpMoney = { amount: number; currency: string }; // amount in minor units
export type UcpVariant = {
  id: string;
  title?: string;
  price?: UcpMoney;
  availability?: { available: boolean };
  options?: { name: string; label: string }[];
  media?: { type: string; url: string }[];
};
export type UcpProduct = {
  id: string;
  title: string;
  description?: { html?: string; plain?: string };
  url?: string;
  price_range?: { min: UcpMoney; max: UcpMoney };
  seller?: { name?: string; id?: string; domain?: string; url?: string };
  media?: { type: string; url: string; alt_text?: string }[];
  variants?: UcpVariant[];
};
export type CatalogSearchResult = { products: UcpProduct[]; pagination?: { cursor?: string } };

export type CatalogFilters = {
  price?: { min?: number; max?: number }; // minor units
  available?: boolean;
  shops?: string[]; // gid://shopify/Shop/…
};

export function searchGlobalCatalog(query: string, filters?: CatalogFilters, signal?: AbortSignal) {
  return callTool<CatalogSearchResult>(GLOBAL_CATALOG_URL, "search_catalog", { catalog: { query, filters } }, { signal });
}

export function searchStoreCatalog(merchantDomain: string, query: string, filters?: CatalogFilters, signal?: AbortSignal) {
  return callTool<CatalogSearchResult>(storefrontUrl(merchantDomain), "search_catalog", { catalog: { query, filters } }, { signal });
}

export type CartResult = { cart?: { id?: string; checkout_url?: string; total?: unknown; lines?: unknown[] }; [k: string]: unknown };

/** Creates (cart_id omitted) or updates a real cart on the merchant. Returns the raw tool payload. */
export function updateCart(
  merchantDomain: string,
  addItems: { product_variant_id: string; quantity: number }[],
  cartId?: string,
  signal?: AbortSignal,
) {
  return callTool<CartResult>(
    storefrontUrl(merchantDomain),
    "update_cart",
    { ...(cartId ? { cart_id: cartId } : {}), add_items: addItems },
    { signal },
  );
}

export function getCart(merchantDomain: string, cartId: string, signal?: AbortSignal) {
  return callTool<CartResult>(storefrontUrl(merchantDomain), "get_cart", { cart_id: cartId }, { signal });
}

/** Extract cart id + checkout URL from whatever shape the store returns (text or structured). */
export function extractCart(payload: unknown): { cartId?: string; checkoutUrl?: string } {
  const s = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    cartId: s.match(/gid:\/\/shopify\/Cart\/[^"\\\s]+/)?.[0],
    checkoutUrl: s.match(/https:\/\/[^"\\\s]+\/cart\/c\/[^"\\\s]+/)?.[0],
  };
}
