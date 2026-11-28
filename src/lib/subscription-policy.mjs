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

/**
 * Opt one server-configured workspace into sandbox command enforcement for a bounded test.
 * Global enforcement and explicit owner exemptions retain their existing semantics.
 * @param {Record<string,string|undefined>} env
 * @param {string} userId
 * @param {boolean} sandboxEnabled
 * @param {number} nowMs
 */
export function commandEnforcementMode(env, userId, sandboxEnabled, nowMs = Date.now()) {
  const owners = (env.MCPOS_BILLING_EXEMPT_USER_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
  if (owners.includes(userId)) return "exempt";
  if (env.MCPOS_ENFORCE_SUBSCRIPTIONS === "true") return "global";
  if (!sandboxEnabled || !env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) return "off";
  const pilotId = env.MCPOS_SANDBOX_PILOT_USER_ID;
  if (!pilotId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pilotId) || pilotId !== userId) return "off";
  const deadline = Date.parse(env.MCPOS_SANDBOX_PILOT_UNTIL || "");
  if (!Number.isFinite(deadline) || deadline <= nowMs || deadline > nowMs + 60 * 60 * 1000) return "off";
  return "pilot";
}
