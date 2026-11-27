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

  const revoked = await supabaseRest("rpc/revoke_mcpos_oauth_session", {
    method: "POST",
    body: JSON.stringify({ p_token_hash: hashOAuthToken(token), p_client_id: clientId }),
  });
  if (!revoked.ok) return oauthError("server_error", "Could not revoke the session. Please retry.", 503);
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
