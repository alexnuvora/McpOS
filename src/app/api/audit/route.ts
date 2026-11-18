import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 100;
  const response = await supabaseRest(
    `mcpos_device_audit?select=id,device_id,event_type,outcome,metadata,created_at&user_id=eq.${auth.account.userId}&order=created_at.desc&limit=${limit}`,
  );
  if (!response.ok) return NextResponse.json({ error: "Could not load audit history." }, { status: 503 });
  return NextResponse.json({ events: await response.json() }, { headers: { "Cache-Control": "no-store" } });
}
