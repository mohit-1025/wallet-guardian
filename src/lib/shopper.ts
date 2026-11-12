import type { Currency, MockPrice, MockProduct } from "./types";
import { formatMoney } from "./money";

export interface ScoredPrice extends MockPrice {
  total: number;
  costScore: number;
  deliveryScore: number;
  returnScore: number;
  finalScore: number;
  rank: number;
}

/**
 * Transparent "Best trusted & cheap" score:
 * price 50%, seller trust 30%, delivery speed 10%, returns window 10%.
 * Each factor is normalised 0-100 within the visible offers.
 */
export function scoreOffers(prices: MockPrice[]): ScoredPrice[] {
  const inStock = prices.filter((p) => p.inStock);
  const pool = inStock.length ? inStock : prices;
  if (!pool.length) return [];
  const totals = pool.map((p) => p.price + p.shipping);
  const minTotal = Math.min(...totals);
  const maxTotal = Math.max(...totals);
  const maxDelivery = Math.max(...pool.map((p) => p.deliveryDays));
  const minDelivery = Math.min(...pool.map((p) => p.deliveryDays));
  const maxReturn = Math.max(...pool.map((p) => p.returnDays));
  const minReturn = Math.min(...pool.map((p) => p.returnDays));

  const scored = prices.map((p) => {
    const total = p.price + p.shipping;
    const costScore = maxTotal === minTotal ? 100 : ((maxTotal - total) / (maxTotal - minTotal)) * 100;
    const deliveryScore = maxDelivery === minDelivery ? 100 : ((maxDelivery - p.deliveryDays) / (maxDelivery - minDelivery)) * 100;
    const returnScore = maxReturn === minReturn ? 100 : ((p.returnDays - minReturn) / (maxReturn - minReturn)) * 100;
    const finalScore = costScore * 0.5 + p.trustScore * 0.3 + deliveryScore * 0.1 + returnScore * 0.1;
    return { ...p, total, costScore, deliveryScore, returnScore, finalScore: Math.round(finalScore), rank: 0 };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored.map((p, i) => ({ ...p, rank: i + 1 }));
}

export function bestPick(scored: ScoredPrice[]): ScoredPrice | null {
  return scored[0] ?? null;
}

export function cheapestOffer(scored: ScoredPrice[]): ScoredPrice | null {
  return [...scored].sort((a, b) => a.total - b.total)[0] ?? null;
}

export function describePick(product: MockProduct, scored: ScoredPrice[], currency: Currency): string {
  const best = scored[0];
  if (!best) return "No offers are available for this product right now.";
  const cheapest = cheapestOffer(scored);
  const cheapestNote =
    cheapest && cheapest.id !== best.id
      ? ` ${cheapest.retailer} is ${formatMoney(cheapest.total, currency)} cheaper, but its seller trust is ${cheapest.trustScore}/100 versus ${best.trustScore}/100.`
      : "";
  const trustReason = best.trustScore >= 90 ? "a high-trust seller" : best.trustScore >= 85 ? "a reliable seller" : "a reasonable seller";
  return `I'd pick ${best.retailer} for the ${product.name}. It scores ${best.finalScore}/100 on the transparent mix (price 50%, trust 30%, delivery 10%, returns 10%). You pay ${best.total === best.price ? "no shipping" : `a total of ${formatMoney(best.total, currency)}`}, from ${trustReason}, delivered in ${best.deliveryDays} day${best.deliveryDays === 1 ? "" : "s"} with ${best.returnDays}-day returns.${cheapestNote}`;
}

export function findProduct(products: MockProduct[], query: string): MockProduct | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    products.find((p) => p.name.toLowerCase() === q) ??
    products.find((p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase().split(" ")[0])) ??
    products.find((p) => p.tags.some((t) => q.includes(t) || t.includes(q)) || p.brand.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) ??
    null
  );
}
