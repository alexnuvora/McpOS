import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const headers = {"Cache-Control":"no-store"};
  try {
    const date = new Date().toISOString().slice(0,10);
    const start = date + "T00:00:00.000Z";
    const end = new Date(Date.parse(start)+86400000).toISOString();
    const user = encodeURIComponent(auth.account.userId);
    const response = await supabaseRest("mcpos_device_commands?select=id&user_id=eq."+user+"&created_at=gte."+encodeURIComponent(start)+"&created_at=lt."+encodeURIComponent(end)+"&limit=1", {method:"HEAD",headers:{Prefer:"count=exact"}});
    if (!response.ok) throw new Error("Usage unavailable");
    const total = response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
    const used = total === undefined ? NaN : Number(total);
    if (!Number.isSafeInteger(used) || used < 0) throw new Error("Invalid count");
    return NextResponse.json({used,date,resetAt:end,metric:"accepted_commands"}, {headers});
  } catch { return NextResponse.json({error:"Daily command activity unavailable."},{status:503,headers}); }
}
