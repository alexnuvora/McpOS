import { mcposAppOrigin } from "@/lib/app-origin";
import { supabaseRest } from "@/lib/device-auth";

const previewOrigin = "https://deploy-preview-12--mcpos-dashboard.netlify.app";

export function sandboxBillingEnabled(): boolean {
  if (process.env.MCPOS_BILLING_ENABLED === "false") return false;
  // The trusted build marker is only set for this Netlify deploy preview.
  return process.env.MCPOS_BUILD_PREVIEW_ORIGIN === previewOrigin ||
    process.env.MCPOS_BILLING_ENABLED === "true";
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
  const previewOriginConfigured = appOrigin.replace(/\/$/, "") === "https://deploy-preview-12--mcpos-dashboard.netlify.app";
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
  let stripePricesVerified = false;
  let stripePortalVerified = false;
  // Do not send a live-mode key to Stripe. No remote writes or customer data reads.
  if (keyConfigured && pricesConfigured && portalConfigured) {
    const read = async (path: string) => {
      const r = await fetch("https://api.stripe.com/v1/" + path, { headers: { Authorization: "Bearer " + key }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      return r.ok ? await r.json() : null;
    };
    try {
      const account = await read("account");
      stripeAccountVerified = account?.id === sandboxAccount;
      if (stripeAccountVerified) {
        const [prices, portal] = await Promise.all([
          Promise.all(priceIds.map(id => read("prices/" + encodeURIComponent(id!)))),
          read("billing_portal/configurations/" + encodeURIComponent(portalId!)),
        ]);
        stripePricesVerified = prices.every((price, i) => price?.id === priceIds[i] && price.livemode === false && price.active === true && price.currency === "gbp" && price.unit_amount === plans[i].amount && price.recurring?.interval === "month" && price.recurring?.interval_count === 1);
        stripePortalVerified = portal?.id === portalId && portal.livemode === false && portal.active === true;
      }
    } catch { /* Report only booleans; never expose provider responses or keys. */ }
  }
  const checks = { keyConfigured, webhookSecretConfigured, pricesConfigured, portalConfigured, previewOriginConfigured, ledgerReady, reservationsReady, quotasReady, stripeAccountVerified, stripePricesVerified, stripePortalVerified, enforcementDisabled, publicRegistrationDisabled };
  return { readyForPreviewCheckout: Object.values(checks).every(Boolean) && enabled, enabled, checks, webhookDeliveryVerified: false };
}
