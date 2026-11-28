import { sandboxBillingEnabled } from "@/lib/sandbox-billing";
import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";
import { getSandboxSubscriptions, getCommandEnforcementMode } from "@/lib/billing-entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const key = process.env.STRIPE_SECRET_KEY;
  const headers = { "Cache-Control": "no-store" };
  if (!sandboxBillingEnabled() || !key?.startsWith("sk_test_")) return NextResponse.json({ enabled: false, subscriptions: [] }, { headers });
  try {
    const subscriptions = await getSandboxSubscriptions(auth.account.userId);
    const limits = { personal: 500, professional: 2000, business: 10000 } as const;
    const plan = (["business", "professional", "personal"] as const).find(p => subscriptions.some(s => s.active && s.plan === p));
    const enforcementMode = getCommandEnforcementMode(auth.account.userId);
    const exempt = enforcementMode === "exempt";
    const enforcing = enforcementMode === "pilot" || enforcementMode === "global";
    const day = new Date().toISOString().slice(0,10);
    let usage = null;
    if (enforcing && plan && !exempt) {
      const result = await supabaseRest("mcpos_daily_command_usage?select=command_count&user_id=eq." + encodeURIComponent(auth.account.userId) + "&usage_date=eq." + day + "&limit=1");
      if (!result.ok) throw new Error("Usage unavailable");
      const rows = await result.json();
      const used = rows[0]?.command_count ?? 0;
      if (!Number.isSafeInteger(used) || used < 0) throw new Error("Invalid usage");
      usage = { used, limit: limits[plan], date: day };
    }
    return NextResponse.json({ enabled: true, subscriptions, usage, enforcing, exempt, enforcementMode }, { headers });
  } catch { return NextResponse.json({ error: "Subscription status unavailable." }, { status: 503, headers }); }
}
