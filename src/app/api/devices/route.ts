import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount, newPairingCode, supabaseRest } from "@/lib/device-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await getDeviceAccount(request);
  if ("response" in result) return result.response;
  const { account } = result;
  const response = await supabaseRest(
    `mcpos_devices?select=id,device_name,platform,status,last_seen_at,paired_at,revoked_at&user_id=eq.${account.userId}&order=paired_at.desc`,
  );
  if (!response.ok) return NextResponse.json({ error: "Could not load paired devices." }, { status: 503 });
  const devices = await response.json() as Array<{
    id: string; device_name: string; platform: string; status: string;
    last_seen_at: string | null; paired_at: string; revoked_at: string | null;
  }>;
  const now = Date.now();
  return NextResponse.json({
    devices: devices.map(device => ({
      ...device,
      status: device.status === "revoked" ? "revoked" :
        device.last_seen_at && now - Date.parse(device.last_seen_at) < 90_000 ? "online" : "offline",
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const result = await getDeviceAccount(request);
  if ("response" in result) return result.response;
  let body: { device_name?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const deviceName = typeof body.device_name === "string" ? body.device_name.trim() : "";
  if (deviceName.length < 1 || deviceName.length > 120) {
    return NextResponse.json({ error: "Device name must be between 1 and 120 characters." }, { status: 400 });
  }

  const code = newPairingCode();
  const codeHash = createHash("sha256").update(code).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const insert = await supabaseRest("mcpos_pairing_codes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: result.account.userId,
      code_hash: codeHash,
      device_name: deviceName,
      expires_at: expiresAt,
    }),
  });
  if (!insert.ok) {
    console.error("McpOS pairing-code insert failed:", insert.status, (await insert.text()).slice(0, 300));
    return NextResponse.json({ error: "Could not create a pairing code. Try again." }, { status: 503 });
  }
  return NextResponse.json({ code, expires_at: expiresAt, device_name: deviceName }, {
    headers: { "Cache-Control": "no-store" },
  });
}
