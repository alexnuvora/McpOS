/**
 * Resolve an entitlement only from a configured price and an active, unexpired subscription.
 * @param {Record<string,string|undefined>} prices
 * @param {string} priceId
 * @param {string} status
 * @param {number|null} periodEnd
 * @param {number} nowMs
 */
export function resolveSubscription(prices, priceId, status, periodEnd, nowMs = Date.now()) {
  const plan = Object.entries(prices).find(([, configured]) => configured && configured === priceId)?.[0] ?? null;
  const active = Boolean(plan && typeof periodEnd === "number" && Number.isSafeInteger(periodEnd) && periodEnd * 1000 > nowMs && status === "active");
  return { plan, active };
}
