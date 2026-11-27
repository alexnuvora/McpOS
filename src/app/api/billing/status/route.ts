import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount } from "@/lib/device-auth";
import { getSandboxSubscriptions } from "@/lib/billing-entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const key = process.env.STRIPE_SECRET_KEY;
  const headers = { "Cache-Control": "no-store" };
  if (process.env.MCPOS_BILLING_ENABLED !== "true" || !key?.startsWith("sk_test_")) return NextResponse.json({ enabled: false, subscriptions: [] }, { headers });
  try {
    return NextResponse.json({ enabled: true, subscriptions: await getSandboxSubscriptions(auth.account.userId) }, { headers });
  } catch { return NextResponse.json({ error: "Subscription status unavailable." }, { status: 503, headers }); }
}
