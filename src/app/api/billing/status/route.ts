import { NextRequest, NextResponse } from "next/server";
import * as z from "zod/v4";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  id: z.string(), livemode: z.literal(false), customer: z.string(),
  status: z.string(), metadata: z.record(z.string(), z.string()),
  cancel_at_period_end: z.boolean().optional(),
  current_period_end: z.number().int().positive().optional(),
  items: z.object({ data: z.array(z.object({
    price: z.object({ id: z.string() }), current_period_end: z.number().int().positive().optional(),
  })).length(1) }),
});

export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.MCPOS_BILLING_ENABLED !== "true" || !key?.startsWith("sk_test_")) {
    return NextResponse.json({ enabled: false, subscriptions: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const userId = auth.account.userId;
  const prices = { personal: process.env.STRIPE_PRICE_PERSONAL, professional: process.env.STRIPE_PRICE_PROFESSIONAL, business: process.env.STRIPE_PRICE_BUSINESS };
  try {
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
      const plan = Object.entries(prices).find(([, price]) => price && item.price.id === price)?.[0] ?? null;
      const end = item.current_period_end ?? sub.current_period_end ?? null;
      const active = Boolean(plan && end && end * 1000 > Date.now() && sub.status === "active");
      return { id, plan, status: sub.status, currentPeriodEnd: end, cancelAtPeriodEnd: sub.cancel_at_period_end ?? false, active };
    }));
    return NextResponse.json({ enabled: true, subscriptions }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Subscription status unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
