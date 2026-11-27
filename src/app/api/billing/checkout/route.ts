import { NextRequest, NextResponse } from "next/server";
import * as z from "zod/v4";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";
import { getSandboxSubscriptions } from "@/lib/billing-entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const attemptSchema = z.object({
  attempt_id: z.string().uuid(),
  plan: z.string(),
  price_id: z.string(),
  customer_email: z.string(),
  expires_at: z.number().int(),
  stripe_session_id: z.string().regex(/^cs_test_[A-Za-z0-9]+$/).nullable(),
});
const sessionSchema = z.object({
  id: z.string().regex(/^cs_test_[A-Za-z0-9]+$/),
  livemode: z.literal(false),
  status: z.enum(["open", "complete", "expired"]),
  client_reference_id: z.string(),
  metadata: z.object({ mcpos_attempt_id: z.string() }),
  subscription: z.string().nullable(),
  url: z.string().nullable(),
});
const headers = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const key = process.env.STRIPE_SECRET_KEY;
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.MCPOS_BILLING_ENABLED !== "true" || !key?.startsWith("sk_test_") || !configuredUrl) {
    return NextResponse.json({ error: "Sandbox billing is unavailable." }, { status: 503, headers });
  }
  const base = new URL(configuredUrl);
  if (request.headers.get("origin") !== base.origin) return NextResponse.json({ error: "Origin not allowed." }, { status: 403, headers });
  const body = await request.json().catch(() => null);
  const prices = { personal: process.env.STRIPE_PRICE_PERSONAL, professional: process.env.STRIPE_PRICE_PROFESSIONAL, business: process.env.STRIPE_PRICE_BUSINESS };
  const plan = body?.plan;
  if (typeof plan !== "string" || !Object.hasOwn(prices, plan)) return NextResponse.json({ error: "Invalid plan." }, { status: 400, headers });
  const price = prices[plan as keyof typeof prices];
  if (!price?.startsWith("price_")) return NextResponse.json({ error: "Plan not configured." }, { status: 503, headers });

  const userId = auth.account.userId;
  const userFilter = "mcpos_checkout_attempts?user_id=eq." + encodeURIComponent(userId);
  const stripeHeaders = { Authorization: "Bearer " + key };
  try {
    const existing = await getSandboxSubscriptions(userId);
    if (existing.some(sub => !["canceled", "incomplete_expired"].includes(sub.status))) return NextResponse.json({ error: "Manage your existing subscription before starting another checkout." }, { status: 409, headers });

    const reserve = await supabaseRest("mcpos_checkout_attempts?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: userId, plan, price_id: price, customer_email: auth.account.email, expires_at: Math.floor(Date.now()/1000) + 3600 }),
    });
    if (!reserve.ok) throw new Error("Checkout reservation unavailable");
    const read = await supabaseRest(userFilter + "&select=attempt_id,plan,price_id,customer_email,expires_at,stripe_session_id");
    if (!read.ok) throw new Error("Checkout reservation unavailable");
    const [attempt] = z.array(attemptSchema).length(1).parse(await read.json());
    const exactFilter = userFilter + "&attempt_id=eq." + attempt.attempt_id;
    let session: z.infer<typeof sessionSchema>;
    if (attempt.stripe_session_id) {
      const response = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(attempt.stripe_session_id), { headers: stripeHeaders, cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Checkout reconciliation unavailable");
      session = sessionSchema.parse(await response.json());
      if (session.id !== attempt.stripe_session_id) throw new Error("Session mismatch");
    } else {
      if (attempt.plan !== plan || attempt.price_id !== price) return NextResponse.json({ error: "Another plan already has a pending checkout. Complete it first." }, { status: 409, headers });
      // Stripe requires expires_at to be at least 30 minutes ahead when creating a session.
      // Do not release an unresolved reservation: Stripe may have accepted an earlier request.
      if (attempt.expires_at < Math.floor(Date.now()/1000) + 1800) return NextResponse.json({ error: "An unresolved checkout requires reconciliation before another can start." }, { status: 409, headers });
      const params = new URLSearchParams({
        mode: "subscription",
        "line_items[0][price]": attempt.price_id,
        "line_items[0][quantity]": "1",
        client_reference_id: userId,
        customer_email: attempt.customer_email,
        expires_at: String(attempt.expires_at),
        "metadata[mcpos_attempt_id]": attempt.attempt_id,
        "subscription_data[metadata][mcpos_user_id]": userId,
        "subscription_data[metadata][mcpos_plan]": attempt.plan,
        success_url: new URL("/billing?checkout=success", base).href,
        cancel_url: new URL("/billing?checkout=cancelled", base).href,
      });
      const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { ...stripeHeaders, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": "mcpos-checkout-" + attempt.attempt_id },
        body: params, cache: "no-store", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Checkout creation unavailable");
      session = sessionSchema.parse(await response.json());
      if (session.client_reference_id !== userId || session.metadata.mcpos_attempt_id !== attempt.attempt_id) throw new Error("Session binding mismatch");
      const save = await supabaseRest(exactFilter, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ stripe_session_id: session.id }) });
      if (!save.ok || z.array(z.unknown()).length(1).safeParse(await save.json()).success !== true) throw new Error("Checkout persistence unavailable");
    }
    if (session.client_reference_id !== userId || session.metadata.mcpos_attempt_id !== attempt.attempt_id) throw new Error("Session binding mismatch");
    const confirmedTerminal = session.status === "complete" && session.subscription && existing.some(sub => sub.id === session.subscription && ["canceled", "incomplete_expired"].includes(sub.status));
    if (session.status === "expired" || confirmedTerminal) {
      const release = await supabaseRest(exactFilter + "&stripe_session_id=eq." + encodeURIComponent(session.id), { method: "DELETE" });
      if (!release.ok) throw new Error("Checkout reconciliation unavailable");
      return NextResponse.json({ error: "Previous checkout resolved. Select a plan again." }, { status: 409, headers });
    }
    if (session.status !== "open") return NextResponse.json({ error: "Checkout completed. Wait for verified subscription status before proceeding." }, { status: 409, headers });
    if (attempt.plan !== plan || attempt.price_id !== price) return NextResponse.json({ error: "Another plan already has an open checkout." }, { status: 409, headers });
    if (!session.url || new URL(session.url).origin !== "https://checkout.stripe.com") throw new Error("Invalid sandbox checkout response");
    return NextResponse.json({ url: session.url }, { headers });
  } catch {
    return NextResponse.json({ error: "Checkout service unavailable. No new checkout will be started until the existing attempt is reconciled." }, { status: 503, headers });
  }
}
