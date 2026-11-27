import * as z from "zod/v4";
import { supabaseRest } from "@/lib/device-auth";
import { resolveSubscription } from "@/lib/subscription-policy.mjs";

const schema = z.object({
  id: z.string(), livemode: z.literal(false), customer: z.string(),
  status: z.string(), metadata: z.record(z.string(), z.string()),
  cancel_at_period_end: z.boolean().optional(),
  current_period_end: z.number().int().positive().optional(),
  items: z.object({ data: z.array(z.object({
    price: z.object({ id: z.string() }), current_period_end: z.number().int().positive().optional(),
  })).length(1) }),
});

export async function getSandboxSubscriptions(userId: string) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.MCPOS_BILLING_ENABLED !== "true" || !key?.startsWith("sk_test_")) throw new Error("Sandbox billing unavailable");
  const prices = { personal: process.env.STRIPE_PRICE_PERSONAL, professional: process.env.STRIPE_PRICE_PROFESSIONAL, business: process.env.STRIPE_PRICE_BUSINESS };
  const ledger = await supabaseRest("mcpos_billing_events?select=stripe_subscription_id&user_id=eq." + encodeURIComponent(userId) + "&order=event_created_at.desc&limit=1000");
  if (!ledger.ok) throw new Error("Ledger unavailable");
  const rows = z.array(z.object({ stripe_subscription_id: z.string().regex(/^sub_[A-Za-z0-9]+$/) })).parse(await ledger.json());
  const ids = [...new Set(rows.map(row => row.stripe_subscription_id))];
  // Bound remote work and fail closed instead of silently omitting subscriptions.
  if (rows.length >= 1000 || ids.length > 20) throw new Error("Reconciliation required");
  const subscriptions = await Promise.all(ids.map(async id => {
    const response = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + key }, cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Stripe unavailable");
    const sub = schema.parse(await response.json());
    if (sub.id !== id || sub.metadata.mcpos_user_id !== userId) throw new Error("Account binding mismatch");
    const item = sub.items.data[0];
    const end = item.current_period_end ?? sub.current_period_end ?? null;
    const { plan, active } = resolveSubscription(prices, item.price.id, sub.status, end);
    return { id, plan, status: sub.status, currentPeriodEnd: end, cancelAtPeriodEnd: sub.cancel_at_period_end ?? false, active };
  }));
  return subscriptions;
}

export async function checkCommandEntitlement(userId: string): Promise<"allowed" | "subscription_required" | "unavailable"> {
  if (process.env.MCPOS_ENFORCE_SUBSCRIPTIONS !== "true") return "allowed";
  const owners = (process.env.MCPOS_BILLING_EXEMPT_USER_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
  if (owners.includes(userId)) return "allowed";
  try {
    const subscriptions = await getSandboxSubscriptions(userId);
    return subscriptions.some(sub => sub.active) ? "allowed" : "subscription_required";
  } catch { return "unavailable"; }
}
