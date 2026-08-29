/** One real Shopify cart per merchant for the selected candidates → checkout URLs. */
import { extractCart, updateCart } from "../shopify/mcp";
import { selectedCandidate, type MerchantCart, type Mission } from "./types";

export async function prepareCheckout(m: Mission, signal?: AbortSignal): Promise<{ carts: Record<string, MerchantCart> }> {
  const byMerchant = new Map<string, MerchantCart>();
  for (const s of m.slots) {
    const c = selectedCandidate(s);
    if (!c) continue;
    const cart = byMerchant.get(c.merchant_domain) ?? { merchant_domain: c.merchant_domain, total_cents: 0, currency: c.currency, lines: [] };
    cart.lines.push({ candidate_id: c.id, title: c.title, price_cents: c.price_cents });
    cart.total_cents += c.price_cents;
    byMerchant.set(c.merchant_domain, cart);
  }
  await Promise.all(
    [...byMerchant.values()].map(async (cart) => {
      const items = cart.lines
        .map((l) => m.slots.flatMap((s) => s.candidates).find((c) => c.id === l.candidate_id)?.variant_id)
        .filter((v): v is string => !!v)
        .map((product_variant_id) => ({ product_variant_id, quantity: 1 }));
      if (items.length === 0) {
        cart.error = "no purchasable variant ids";
        return;
      }
      try {
        const payload = await updateCart(cart.merchant_domain, items, undefined, signal);
        const { cartId, checkoutUrl } = extractCart(payload);
        cart.cart_id = cartId;
        cart.checkout_url = checkoutUrl;
        if (!checkoutUrl) cart.error = "merchant returned no checkout URL";
      } catch (e) {
        cart.error = String((e as Error).message).slice(0, 120);
      }
    }),
  );
  return { carts: Object.fromEntries(byMerchant) };
}
