import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount } from "@/lib/device-auth";
import { getSandboxSubscriptions } from "@/lib/billing-entitlement";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const key = process.env.STRIPE_SECRET_KEY;
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.MCPOS_BILLING_ENABLED !== "true" || !key?.startsWith("sk_test_") || !configuredUrl) {
    return NextResponse.json({ error: "Sandbox billing is unavailable." }, { status: 503 });
  }
  const base = new URL(configuredUrl);
  if (request.headers.get("origin") !== base.origin) return NextResponse.json({ error: "Origin not allowed." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const prices = { personal: process.env.STRIPE_PRICE_PERSONAL, professional: process.env.STRIPE_PRICE_PROFESSIONAL, business: process.env.STRIPE_PRICE_BUSINESS };
  const plan = body?.plan;
  if (typeof plan !== "string" || !Object.hasOwn(prices, plan)) return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
  const price = prices[plan as keyof typeof prices];
  if (!price?.startsWith("price_")) return NextResponse.json({ error: "Plan not configured." }, { status: 503 });
  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: auth.account.userId,
    customer_email: auth.account.email,
    "subscription_data[metadata][mcpos_user_id]": auth.account.userId,
    "subscription_data[metadata][mcpos_plan]": plan,
    success_url: new URL("/billing?checkout=success", base).href,
    cancel_url: new URL("/billing?checkout=cancelled", base).href,
  });
  try {
    const existing = await getSandboxSubscriptions(auth.account.userId);
    if (existing.some(sub => !["canceled", "incomplete_expired"].includes(sub.status))) return NextResponse.json({ error: "An existing subscription must be managed before starting another checkout." }, { status: 409 });
    // Deduplicate repeated clicks in the same short window. Full cross-window checkout locking is a separate rollout requirement.
    const idempotency = createHash("sha256").update(auth.account.userId + ":" + plan + ":" + Math.floor(Date.now() / 300_000)).digest("hex");
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": "mcpos-checkout-" + idempotency },
      body: params,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return NextResponse.json({ error: "Checkout could not be created." }, { status: 502 });
    const session = await response.json();
    if (session.livemode !== false || typeof session.url !== "string" || new URL(session.url).origin !== "https://checkout.stripe.com") return NextResponse.json({ error: "Invalid sandbox checkout response." }, { status: 502 });
    return NextResponse.json({ url: session.url }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Checkout service unavailable." }, { status: 503 });
  }
}
