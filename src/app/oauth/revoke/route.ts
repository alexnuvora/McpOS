import { NextRequest } from "next/server";
import { hashOAuthToken, oauthError, readOAuthBody } from "@/lib/mcp-oauth";
import { supabaseRest } from "@/lib/device-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const raw = await readOAuthBody(request);
  if (raw === null) return oauthError("invalid_request", "Request body is too large or invalid.", 413);
  const form = new URLSearchParams(raw);
  for (const name of new Set(form.keys())) if (form.getAll(name).length !== 1) return oauthError("invalid_request", "Duplicate parameters are not allowed.");
  const token = form.get("token") || "";
  const clientId = form.get("client_id") || "";
  if (!token || !clientId) return oauthError("invalid_request", "token and client_id are required.");

  const refreshHash = hashOAuthToken(token);
  const refresh = await supabaseRest(`mcpos_oauth_refresh_tokens?token_hash=eq.${refreshHash}&client_id=eq.${encodeURIComponent(clientId)}&revoked_at=is.null`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  if (!refresh.ok) return oauthError("server_error", "Could not revoke the token.", 503);
  const revoked = await refresh.json();
  let userId: string | null = revoked[0]?.user_id ?? null;
  if (revoked.length) {
    await supabaseRest(`mcpos_mcp_clients?id=eq.${revoked[0].mcp_client_id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
    await supabaseRest(`mcpos_oauth_refresh_tokens?mcp_client_id=eq.${revoked[0].mcp_client_id}&revoked_at=is.null`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
  } else {
    // Access tokens may only be revoked through their owning OAuth registration.
    // Static keys have no OAuth registration and are managed in the dashboard.
    const access = await supabaseRest(`mcpos_mcp_clients?select=id,user_id&token_hash=eq.${refreshHash}&revoked_at=is.null&limit=1`);
    if (!access.ok) return oauthError("server_error", "Could not verify the token.", 503);
    const [candidate] = await access.json();
    if (candidate) {
      const binding = await supabaseRest(`mcpos_oauth_refresh_tokens?select=mcp_client_id&client_id=eq.${encodeURIComponent(clientId)}&mcp_client_id=eq.${candidate.id}&user_id=eq.${candidate.user_id}&limit=1`);
      if (!binding.ok) return oauthError("server_error", "Could not verify the OAuth session.", 503);
      if ((await binding.json()).length === 1) {
        const revokedAccess = await supabaseRest(`mcpos_mcp_clients?id=eq.${candidate.id}&user_id=eq.${candidate.user_id}&token_hash=eq.${refreshHash}&revoked_at=is.null`, {
          method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
        });
        if (!revokedAccess.ok) return oauthError("server_error", "Could not revoke the token.", 503);
        if ((await revokedAccess.json()).length === 1) {
          userId = candidate.user_id;
          const revokedRefresh = await supabaseRest(`mcpos_oauth_refresh_tokens?mcp_client_id=eq.${candidate.id}&client_id=eq.${encodeURIComponent(clientId)}&revoked_at=is.null`, {
            method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
          });
          if (!revokedRefresh.ok) return oauthError("server_error", "Could not revoke the refresh session.", 503);
        }
      }
    }
  }
  if (userId) {
    await supabaseRest("mcpos_device_audit", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: userId, event_type: "mcp.oauth.revoked", outcome: "success", metadata: { client_id: clientId } }),
    });
  }
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
