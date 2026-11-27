import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount } from "@/lib/device-auth";
import { isAllowedMcpOSEmail } from "@/lib/supabase/server";
import { sandboxBillingReadiness } from "@/lib/sandbox-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  if (!isAllowedMcpOSEmail(auth.account.email)) return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  return NextResponse.json(await sandboxBillingReadiness(), { headers: { "Cache-Control": "no-store" } });
}
