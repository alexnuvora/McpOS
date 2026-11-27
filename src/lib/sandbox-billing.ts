import { mcposAppOrigin } from "@/lib/app-origin";
import { supabaseRest } from "@/lib/device-auth";

import { hostedSandboxOriginAllowed, sandboxOriginEnabled } from "@/lib/sandbox-origin-policy.mjs";

export function sandboxBillingEnabled(): boolean {
  return sandboxOriginEnabled(process.env, mcposAppOrigin());
}

const sandboxAccount = "acct_1TNzE92NnZDbZsO0";
const plans = [
  { env: "STRIPE_PRICE_PERSONAL", amount: 999 },
  { env: "STRIPE_PRICE_PROFESSIONAL", amount: 1999 },
  { env: "STRIPE_PRICE_BUSINESS", amount: 4999 },
] as const;

export async function sandboxBillingReadiness() {
  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const keyConfigured = Boolean(key?.startsWith("sk_test_"));
  const webhookSecretConfigured = Boolean(webhookSecret?.startsWith("whsec_"));
  const priceIds = plans.map(plan => process.env[plan.env]);
  const pricesConfigured = priceIds.every(id => /^price_[A-Za-z0-9]+$/.test(id || "")) && new Set(priceIds).size === 3;
  const portalId = process.env.STRIPE_PORTAL_CONFIGURATION;
  const portalConfigured = /^bpc_[A-Za-z0-9]+$/.test(portalId || "");
  const appOrigin = mcposAppOrigin() || "";
  const previewOriginConfigured = hostedSandboxOriginAllowed(process.env, appOrigin);
  const enabled = sandboxBillingEnabled();
  const enforcementDisabled = process.env.MCPOS_ENFORCE_SUBSCRIPTIONS !== "true";
  const publicRegistrationDisabled = process.env.MCPOS_PUBLIC_REGISTRATION !== "true";
  async function tableReady(table: string) {
    try {
      const r = await supabaseRest(table + "?select=user_id&limit=0", { signal: AbortSignal.timeout(5000) });
      return r.ok;
    } catch { return false; }
  }
  const [ledgerReady, reservationsReady, quotasReady] = await Promise.all([
    tableReady("mcpos_billing_events"), tableReady("mcpos_checkout_attempts"), tableReady("mcpos_daily_command_usage"),
  ]);
  let stripeAccountVerified = false;
  let stripeAccountDiagnostic: "not_checked" | "matched" | "account_mismatch" | "invalid_key" | "permission_denied" | "rate_limited" | "provider_error" | "network_error" = "not_checked";
  let stripePricesVerified = false;
  let stripePortalVerified = false;
  // Do not send a live-mode key to Stripe. No remote writes or customer data reads.
  if (keyConfigured && pricesConfigured && portalConfigured) {
    const read = async (path: string) => {
      const r = await fetch("https://api.stripe.com/v1/" + path, { headers: { Authorization: "Bearer " + key }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      return r.ok ? await r.json() : null;
    };
    try {
      const response = await fetch("https://api.stripe.com/v1/account", { headers: { Authorization: "Bearer " + key }, cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const account = await response.json();
        stripeAccountVerified = account?.id === sandboxAccount;
        stripeAccountDiagnostic = stripeAccountVerified ? "matched" : "account_mismatch";
      } else {
        stripeAccountDiagnostic = response.status === 401 ? "invalid_key" : response.status === 403 ? "permission_denied" : response.status === 429 ? "rate_limited" : "provider_error";
      }
      if (stripeAccountVerified) {
        const [prices, portal] = await Promise.all([
          Promise.all(priceIds.map(id => read("prices/" + encodeURIComponent(id!)))),
          read("billing_portal/configurations/" + encodeURIComponent(portalId!)),
        ]);
        stripePricesVerified = prices.every((price, i) => price?.id === priceIds[i] && price.livemode === false && price.active === true && price.currency === "gbp" && price.unit_amount === plans[i].amount && price.recurring?.interval === "month" && price.recurring?.interval_count === 1);
        stripePortalVerified = portal?.id === portalId && portal.livemode === false && portal.active === true;
      }
    } catch { if (stripeAccountDiagnostic === "not_checked") stripeAccountDiagnostic = "network_error"; }
  }
  const checks = { keyConfigured, webhookSecretConfigured, pricesConfigured, portalConfigured, previewOriginConfigured, ledgerReady, reservationsReady, quotasReady, stripeAccountVerified, stripePricesVerified, stripePortalVerified, enforcementDisabled, publicRegistrationDisabled };
  return { readyForPreviewCheckout: Object.values(checks).every(Boolean) && enabled, enabled, checks, stripeAccountDiagnostic, webhookDeliveryVerified: false };
}
