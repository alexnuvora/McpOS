import { NextRequest } from "next/server";
import { hashOAuthToken, oauthError } from "@/lib/mcp-oauth";
import { supabaseRest } from "@/lib/device-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const form = new URLSearchParams(await request.text());
  const token = form.get("token") || "";
  const clientId = form.get("client_id") || "";
  if (!token || !clientId) return oauthError("invalid_request", "token and client_id are required.");

  const refreshHash = hashOAuthToken(token);
  const refresh = await supabaseRest(`mcpos_oauth_refresh_tokens?token_hash=eq.${refreshHash}&client_id=eq.${encodeURIComponent(clientId)}&revoked_at=is.null`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  if (!refresh.ok) return oauthError("server_error", "Could not revoke the token.", 503);
  const revoked = await refresh.json();
  if (revoked.length) {
    await supabaseRest(`mcpos_mcp_clients?id=eq.${revoked[0].mcp_client_id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
  } else {
    const access = await supabaseRest(`mcpos_mcp_clients?token_hash=eq.${refreshHash}&revoked_at=is.null`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
    if (!access.ok) return oauthError("server_error", "Could not revoke the token.", 503);
    const rows = await access.json();
    if (rows.length) {
      await supabaseRest(`mcpos_oauth_refresh_tokens?mcp_client_id=eq.${rows[0].id}&revoked_at=is.null`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      });
    }
  }
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
