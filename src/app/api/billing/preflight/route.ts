import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";
import { isAllowedMcpOSEmail } from "@/lib/supabase/server";
import { evaluateSandboxEntitlement } from "@/lib/billing-entitlement";
import { isHostedSandboxOrigin, sandboxBillingReadiness } from "@/lib/sandbox-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  if (!isAllowedMcpOSEmail(auth.account.email)) return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  const readiness = await sandboxBillingReadiness();
  // Preview-only, authenticated, read-only evaluation of the same paid policy
  // used by the MCP command gateway. It never enables enforcement or queues work.
  const entitlement = readiness.readyForPreviewCheckout && isHostedSandboxOrigin()
    ? await evaluateSandboxEntitlement(auth.account.userId)
    : null;
  // Evidence from this account's persisted ledger, not a blanket claim about
  // Stripe delivery health or other customers' subscriptions.
  let webhookEvidence: { status: "observed" | "none" | "unavailable" | "not_checked"; latestEventAt: string | null } = { status: "not_checked", latestEventAt: null };
  if (readiness.enabled && readiness.checks.ledgerReady) {
    try {
      const response = await supabaseRest("mcpos_billing_events?select=event_created_at&user_id=eq." + encodeURIComponent(auth.account.userId) + "&order=event_created_at.desc&limit=1", { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Ledger unavailable");
      const [event] = await response.json();
      webhookEvidence = event ? { status: "observed", latestEventAt: event.event_created_at } : { status: "none", latestEventAt: null };
    } catch { webhookEvidence = { status: "unavailable", latestEventAt: null }; }
  }
  return NextResponse.json({ ...readiness, webhookEvidence, entitlementPreview: entitlement ? { status: entitlement.status, plan: entitlement.status === "allowed" ? entitlement.billing.billing_plan ?? null : null, enforcementChanged: false } : null }, { headers: { "Cache-Control": "no-store" } });
}
