import { mcposAppOrigin } from "@/lib/app-origin";
import { NextRequest, NextResponse } from "next/server";
import * as z from "zod/v4";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const key = process.env.STRIPE_SECRET_KEY;
  const appUrl = mcposAppOrigin();
  if (process.env.MCPOS_BILLING_ENABLED !== "true" || !key?.startsWith("sk_test_") || !appUrl) {
    return NextResponse.json({ error: "Sandbox billing is unavailable." }, { status: 503 });
  }
  try {
    const origin = new URL(appUrl).origin;
    if (request.headers.get("origin") !== origin) return NextResponse.json({ error: "Origin not allowed." }, { status: 403 });
    const input = z.object({ subscriptionId: z.string().regex(/^sub_[A-Za-z0-9]+$/) }).safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
    const id = input.data.subscriptionId;
    const userId = auth.account.userId;
    const ledger = await supabaseRest("mcpos_billing_events?select=stripe_subscription_id&user_id=eq." + encodeURIComponent(userId) + "&stripe_subscription_id=eq." + encodeURIComponent(id) + "&limit=1");
    if (!ledger.ok) throw new Error("Ledger unavailable");
    if (z.array(z.object({ stripe_subscription_id: z.literal(id) })).parse(await ledger.json()).length !== 1) {
      return NextResponse.json({ error: "Subscription not found." }, { status: 404 });
    }
    const headers = { Authorization: "Bearer " + key };
    const result = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(id), { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!result.ok) throw new Error("Stripe unavailable");
    const subscription = z.object({
      id: z.literal(id), livemode: z.literal(false), customer: z.string().regex(/^cus_[A-Za-z0-9]+$/),
      metadata: z.object({ mcpos_user_id: z.literal(userId) }),
      items: z.object({ data: z.array(z.object({ price: z.object({ id: z.string() }) })).length(1) }),
    }).parse(await result.json());
    const prices = [process.env.STRIPE_PRICE_PERSONAL, process.env.STRIPE_PRICE_PROFESSIONAL, process.env.STRIPE_PRICE_BUSINESS];
    if (!prices.includes(subscription.items.data[0].price.id)) return NextResponse.json({ error: "Subscription not supported." }, { status: 403 });
    // Checkout creates a customer exclusively for this McpOS account. Verify no other
    // subscriptions belong to a different account or brand before exposing its portal.
    const customerSubs = await fetch("https://api.stripe.com/v1/subscriptions?customer=" + encodeURIComponent(subscription.customer) + "&status=all&limit=100", { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!customerSubs.ok) throw new Error("Customer verification failed");
    const listed = z.object({ has_more: z.literal(false), data: z.array(z.object({
      metadata: z.object({ mcpos_user_id: z.literal(userId) }),
      items: z.object({ data: z.array(z.object({ price: z.object({ id: z.string() }) })).length(1) }),
    })) }).parse(await customerSubs.json());
    if (!listed.data.length || listed.data.some(sub => !prices.includes(sub.items.data[0].price.id))) return NextResponse.json({ error: "Customer account requires review." }, { status: 403 });
    const configuration = process.env.STRIPE_PORTAL_CONFIGURATION;
    if (!configuration?.startsWith("bpc_")) return NextResponse.json({ error: "Sandbox portal not configured." }, { status: 503 });
    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ customer: subscription.customer, configuration, return_url: new URL("/billing", origin).href }),
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Portal unavailable");
    const session = z.object({ livemode: z.literal(false), url: z.string() }).parse(await response.json());
    if (new URL(session.url).origin !== "https://billing.stripe.com") throw new Error("Invalid portal URL");
    return NextResponse.json({ url: session.url }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Billing portal unavailable." }, { status: 503 }); }
}
