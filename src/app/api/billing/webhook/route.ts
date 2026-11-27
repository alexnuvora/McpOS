import { sandboxBillingEnabled } from "@/lib/sandbox-billing";
import { NextRequest, NextResponse } from "next/server";
import * as z from "zod/v4";
import { supabaseRest } from "@/lib/device-auth";
import { readStripeBody, verifyStripeSignature } from "@/lib/stripe-signature.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const eventTypes = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
const eventSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9_]+$/),
  type: z.string(),
  created: z.number().int().positive().max(4102444800),
  livemode: z.literal(false),
  data: z.object({ object: z.unknown() }),
});
const subscriptionSchema = z.object({
  id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  object: z.literal("subscription"),
  livemode: z.literal(false),
  customer: z.string().regex(/^cus_[A-Za-z0-9]+$/),
  status: z.string().max(40),
  metadata: z.record(z.string(), z.string()),
  current_period_end: z.number().int().positive().max(4102444800).optional(),
  items: z.object({ data: z.array(z.object({
    price: z.object({ id: z.string().regex(/^price_[A-Za-z0-9]+$/) }),
    current_period_end: z.number().int().positive().max(4102444800).optional(),
  })).length(1) }),
});

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sandboxBillingEnabled() || !secret || !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    return NextResponse.json({ error: "Sandbox billing is unavailable." }, { status: 503 });
  }
  const raw = await readStripeBody(request);
  if (raw === null) return NextResponse.json({ error: "Payload too large or invalid." }, { status: 413 });
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature") || "", secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const event = eventSchema.safeParse(parsed);
  if (!event.success) return NextResponse.json({ error: "Invalid sandbox event." }, { status: 400 });
  if (!eventTypes.includes(event.data.type)) return NextResponse.json({ received: true, ignored: true });
  const candidate = event.data.data.object;
  // Ignore subscriptions for unrelated brands that share this sandbox.
  const marker = z.object({ metadata: z.object({ mcpos_user_id: z.string().optional() }).optional() }).safeParse(candidate);
  if (!marker.success || !marker.data.metadata?.mcpos_user_id) return NextResponse.json({ received: true, ignored: true });
  const subscription = subscriptionSchema.safeParse(candidate);
  if (!subscription.success) return NextResponse.json({ error: "Unsupported McpOS subscription." }, { status: 422 });
  const sub = subscription.data;
  const user = z.string().uuid().safeParse(sub.metadata.mcpos_user_id);
  if (!user.success) return NextResponse.json({ error: "Invalid account binding." }, { status: 422 });
  const item = sub.items.data[0];
  const periodEnd = item.current_period_end ?? sub.current_period_end;
  try {
    const response = await supabaseRest("mcpos_billing_events?on_conflict=event_id", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        event_id: event.data.id,
        event_type: event.data.type,
        event_created_at: new Date(event.data.created * 1000).toISOString(),
        user_id: user.data,
        stripe_subscription_id: sub.id,
        stripe_customer_id: sub.customer,
        stripe_price_id: item.price.id,
        stripe_status: sub.status,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        livemode: false,
      }),
    });
    if (!response.ok) return NextResponse.json({ error: "Event storage unavailable." }, { status: 503 });
    return NextResponse.json({ received: true });
  } catch { return NextResponse.json({ error: "Event storage unavailable." }, { status: 503 }); }
}
