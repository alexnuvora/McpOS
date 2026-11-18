import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabaseRest } from "@/lib/device-auth";
import { hashOAuthToken, MCP_RESOURCE_URL, newOAuthToken, oauthError } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function tokenResponse(accessToken: string, refreshToken: string, scopes: string[]) {
  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

export async function POST(request: NextRequest) {
  const form = new URLSearchParams(await request.text());
  const grantType = form.get("grant_type") || "";
  const clientId = form.get("client_id") || "";
  const resource = form.get("resource") || "";
  if (!clientId || resource !== MCP_RESOURCE_URL) return oauthError("invalid_request", "client_id and the registered MCP resource are required.");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");

  const clientResponse = await supabaseRest(`mcpos_oauth_clients?select=client_id,client_name&client_id=eq.${encodeURIComponent(clientId)}&limit=1`);
  if (!clientResponse.ok) return oauthError("server_error", "OAuth service is temporarily unavailable.", 503);
  const [oauthClient] = await clientResponse.json();
  if (!oauthClient) return oauthError("invalid_client", "The OAuth client is not registered.");

  if (grantType === "authorization_code") {
    const code = form.get("code") || "";
    const redirectUri = form.get("redirect_uri") || "";
    const verifier = form.get("code_verifier") || "";
    if (!code || verifier.length < 43 || verifier.length > 128 || !/^[-._~A-Za-z0-9]+$/.test(verifier)) {
      return oauthError("invalid_grant", "The authorization code or PKCE verifier is invalid.");
    }
    const codeHash = hashOAuthToken(code);
    const codeResponse = await supabaseRest(`mcpos_oauth_codes?select=code_hash,client_id,user_id,redirect_uri,code_challenge,resource,scopes,expires_at,consumed_at&code_hash=eq.${codeHash}&limit=1`);
    if (!codeResponse.ok) return oauthError("server_error", "Could not verify the authorization code.", 503);
    const [authCode] = await codeResponse.json();
    const calculatedChallenge = createHash("sha256").update(verifier).digest("base64url");
    if (!authCode || authCode.client_id !== clientId || authCode.redirect_uri !== redirectUri ||
        authCode.resource !== resource || authCode.consumed_at || new Date(authCode.expires_at).getTime() <= Date.now() ||
        !sameSecret(calculatedChallenge, authCode.code_challenge)) {
      return oauthError("invalid_grant", "The authorization code is expired, already used, or does not match this PKCE request.");
    }

    const consumed = await supabaseRest(`mcpos_oauth_codes?code_hash=eq.${codeHash}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ consumed_at: new Date().toISOString() }),
    });
    if (!consumed.ok || (await consumed.json()).length !== 1) return oauthError("invalid_grant", "The authorization code has already been consumed.");

    const accessToken = newOAuthToken("mcpos_at_");
    const refreshToken = newOAuthToken("mcpos_rt_");
    const accessExpiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    const scopes = authCode.scopes as string[];

    const mcpClientResponse = await supabaseRest("mcpos_mcp_clients", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: authCode.user_id,
        client_name: String(oauthClient.client_name).slice(0, 80),
        token_hash: hashOAuthToken(accessToken),
        token_expires_at: accessExpiresAt,
        token_resource: resource,
        scopes,
      }),
    });
    if (!mcpClientResponse.ok) return oauthError("server_error", "Could not create the authenticated MCP session.", 503);
    const [mcpClient] = await mcpClientResponse.json();

    const refreshInsert = await supabaseRest("mcpos_oauth_refresh_tokens", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        token_hash: hashOAuthToken(refreshToken), client_id: clientId, mcp_client_id: mcpClient.id,
        user_id: authCode.user_id, resource, scopes, expires_at: refreshExpiresAt,
      }),
    });
    if (!refreshInsert.ok) {
      await supabaseRest(`mcpos_mcp_clients?id=eq.${mcpClient.id}`, { method: "DELETE" });
      return oauthError("server_error", "Could not create the refresh session.", 503);
    }
    await supabaseRest("mcpos_device_audit", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: authCode.user_id, event_type: "mcp.oauth.token_issued", outcome: "success", metadata: { client_name: oauthClient.client_name, scopes } }),
    });
    return tokenResponse(accessToken, refreshToken, scopes);
  }

  const refreshToken = form.get("refresh_token") || "";
  const refreshHash = hashOAuthToken(refreshToken);
  const refreshResponse = await supabaseRest(`mcpos_oauth_refresh_tokens?select=token_hash,client_id,mcp_client_id,user_id,resource,scopes,expires_at,revoked_at&token_hash=eq.${refreshHash}&limit=1`);
  if (!refreshResponse.ok) return oauthError("server_error", "Could not verify the refresh token.", 503);
  const [stored] = await refreshResponse.json();
  if (!stored || stored.client_id !== clientId || stored.resource !== resource || stored.revoked_at || new Date(stored.expires_at).getTime() <= Date.now()) {
    return oauthError("invalid_grant", "The refresh token is invalid, expired, or revoked.");
  }

  const ownerResponse = await supabaseRest(`mcpos_mcp_clients?select=id,revoked_at&id=eq.${stored.mcp_client_id}&limit=1`);
  if (!ownerResponse.ok) return oauthError("server_error", "Could not verify the McpOS session.", 503);
  const [owner] = await ownerResponse.json();
  if (!owner || owner.revoked_at) return oauthError("invalid_grant", "This McpOS session has been revoked.");

  const rotated = await supabaseRest(`mcpos_oauth_refresh_tokens?token_hash=eq.${refreshHash}&revoked_at=is.null`, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  if (!rotated.ok || (await rotated.json()).length !== 1) return oauthError("invalid_grant", "The refresh token has already been rotated.");

  const nextAccessToken = newOAuthToken("mcpos_at_");
  const nextRefreshToken = newOAuthToken("mcpos_rt_");
  const accessExpiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  const updated = await supabaseRest(`mcpos_mcp_clients?id=eq.${stored.mcp_client_id}&revoked_at=is.null`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ token_hash: hashOAuthToken(nextAccessToken), token_expires_at: accessExpiresAt, token_resource: resource, last_used_at: new Date().toISOString() }),
  });
  if (!updated.ok) return oauthError("server_error", "Could not rotate the access token.", 503);
  const inserted = await supabaseRest("mcpos_oauth_refresh_tokens", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      token_hash: hashOAuthToken(nextRefreshToken), client_id: clientId, mcp_client_id: stored.mcp_client_id,
      user_id: stored.user_id, resource, scopes: stored.scopes, expires_at: refreshExpiresAt,
    }),
  });
  if (!inserted.ok) return oauthError("server_error", "Could not rotate the refresh token.", 503);
  return tokenResponse(nextAccessToken, nextRefreshToken, stored.scopes as string[]);
}
