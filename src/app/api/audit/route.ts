import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 100;
  const rawOffset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.min(1_000_000, Math.floor(rawOffset))) : 0;
  const response = await supabaseRest(
    `mcpos_device_audit?select=id,device_id,event_type,outcome,metadata,created_at&user_id=eq.${auth.account.userId}&order=created_at.desc&limit=${limit}&offset=${offset}`,
  );
  if (!response.ok) return NextResponse.json({ error: "Could not load audit history." }, { status: 503 });
  const events = await response.json();
  return NextResponse.json({ events, offset, limit, hasMore: events.length === limit }, { headers: { "Cache-Control": "no-store" } });
}
