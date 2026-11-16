import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ deviceId: string }> },
) {
  const result = await getDeviceAccount(request);
  if ("response" in result) return result.response;
  const { deviceId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return NextResponse.json({ error: "Invalid device ID." }, { status: 400 });

  const revokedAt = new Date().toISOString();
  const device = await supabaseRest(
    `mcpos_devices?id=eq.${deviceId}&user_id=eq.${result.account.userId}&status=neq.revoked`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "revoked", revoked_at: revokedAt }),
    },
  );
  if (!device.ok) return NextResponse.json({ error: "Could not revoke this device." }, { status: 503 });
  const rows = await device.json();
  if (!rows.length) return NextResponse.json({ error: "Device not found or already revoked." }, { status: 404 });

  await supabaseRest(`mcpos_device_credentials?device_id=eq.${deviceId}&revoked_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: revokedAt }),
  });
  await supabaseRest("mcpos_device_audit", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: result.account.userId, device_id: deviceId,
      event_type: "device.revoked", outcome: "success", metadata: {},
    }),
  });
  return NextResponse.json({ ok: true });
}
