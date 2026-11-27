import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseRest } from "@/lib/device-auth";
import { isSafeRedirectUri, oauthError, readOAuthBody } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  const raw = await readOAuthBody(request, 49152);
  if (raw === null) return oauthError("invalid_client_metadata", "Registration document is too large or invalid.", 413);
  try { body = JSON.parse(raw); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid document"); } catch { return oauthError("invalid_client_metadata", "A JSON client registration document is required."); }

  const redirects = body.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 20 || !redirects.every(isSafeRedirectUri)) {
    return oauthError("invalid_redirect_uri", "Register between one and twenty HTTPS redirect URIs.");
  }
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code", "refresh_token"];
  const responseTypes = Array.isArray(body.response_types) ? body.response_types : ["code"];
  if (!grantTypes.includes("authorization_code") || !grantTypes.includes("refresh_token") || grantTypes.some(x => !["authorization_code", "refresh_token"].includes(String(x)))) {
    return oauthError("invalid_client_metadata", "Only authorization_code and refresh_token grants are supported.");
  }
  if (responseTypes.length !== 1 || responseTypes[0] !== "code") {
    return oauthError("invalid_client_metadata", "Only the authorization-code response type is supported.");
  }
  if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
    return oauthError("invalid_client_metadata", "This public PKCE client must use token_endpoint_auth_method none.");
  }
  const clientName = typeof body.client_name === "string" && body.client_name.trim()
    ? body.client_name.trim().slice(0, 120)
    : "ChatGPT MCP client";
  const clientId = "mcpos_oauth_" + randomBytes(24).toString("base64url");
  const response = await supabaseRest("rpc/register_mcpos_oauth_client", {
    method: "POST",
    body: JSON.stringify({ p_client_id: clientId, p_client_name: clientName, p_redirect_uris: redirects }),
  });
  if (!response.ok) {
    console.error("McpOS OAuth client registration failed:", response.status);
    return oauthError("server_error", "Could not register the OAuth client.", 503);
  }
  const registered = await response.json();
  if (registered === false) return NextResponse.json({ error: "temporarily_unavailable", error_description: "Registration limit reached. Try again later." }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  if (registered !== true) return oauthError("server_error", "Could not verify registration.", 503);
  return NextResponse.json({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirects,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, { status: 201, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
