import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount } from "@/lib/device-auth";
import { isAllowedMcpOSEmail } from "@/lib/supabase/server";
import { evaluateSandboxEntitlement } from "@/lib/billing-entitlement";
import { mcposAppOrigin } from "@/lib/app-origin";
import { sandboxBillingReadiness } from "@/lib/sandbox-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  if (!isAllowedMcpOSEmail(auth.account.email)) return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  const readiness = await sandboxBillingReadiness();
  // Preview-only, authenticated, read-only evaluation of the same paid policy
  // used by the MCP command gateway. It never enables enforcement or queues work.
  const entitlement = readiness.readyForPreviewCheckout && mcposAppOrigin() === "https://deploy-preview-12--mcpos-dashboard.netlify.app"
    ? await evaluateSandboxEntitlement(auth.account.userId)
    : null;
  return NextResponse.json({ ...readiness, entitlementPreview: entitlement ? { status: entitlement.status, plan: entitlement.status === "allowed" ? entitlement.billing.billing_plan ?? null : null, enforcementChanged: false } : null }, { headers: { "Cache-Control": "no-store" } });
}
