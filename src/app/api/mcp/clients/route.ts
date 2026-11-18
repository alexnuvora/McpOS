import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const response = await supabaseRest(
    `mcpos_mcp_clients?select=id,client_name,scopes,created_at,last_used_at,revoked_at&user_id=eq.${auth.account.userId}&order=created_at.desc`,
  );
  if (!response.ok) return NextResponse.json({ error: "Could not load MCP clients." }, { status: 503 });
  return NextResponse.json({ clients: await response.json() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  let body: { client_name?: unknown; scopes?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const clientName = typeof body.client_name === "string" ? body.client_name.trim() : "";
  if (clientName.length < 1 || clientName.length > 80) {
    return NextResponse.json({ error: "Client name must be between 1 and 80 characters." }, { status: 400 });
  }

  const requestedScopes = Array.isArray(body.scopes) ? body.scopes.filter((scope): scope is string => typeof scope === "string") : [];
  if (requestedScopes.some(scope => scope !== "screen.capture")) {
    return NextResponse.json({ error: "Unsupported MCP scope requested." }, { status: 400 });
  }
  const scopes = ["workspace.read", "desktop.status", ...new Set(requestedScopes)];

  const token = "mcpos_" + randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const response = await supabaseRest("mcpos_mcp_clients", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: auth.account.userId,
      client_name: clientName,
      token_hash: tokenHash,
      scopes,
    }),
  });
  if (!response.ok) {
    console.error("McpOS MCP client creation failed:", response.status, (await response.text()).slice(0, 300));
    return NextResponse.json({ error: "Could not create the MCP client. Try again." }, { status: 503 });
  }
  const [client] = await response.json();
  return NextResponse.json({
    client: { id: client.id, client_name: client.client_name, scopes: client.scopes, created_at: client.created_at },
    token,
    warning: "Copy this token now. It will not be shown again.",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  let body: { client_id?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (typeof body.client_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.client_id)) {
    return NextResponse.json({ error: "A valid client_id is required." }, { status: 400 });
  }
  const response = await supabaseRest(
    `mcpos_mcp_clients?id=eq.${body.client_id}&user_id=eq.${auth.account.userId}&revoked_at=is.null`,
    { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) },
  );
  if (!response.ok) return NextResponse.json({ error: "Could not revoke the MCP client." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
