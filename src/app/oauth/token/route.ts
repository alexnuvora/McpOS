import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { isMcpOSAccountIdAllowed, supabaseRest } from "@/lib/device-auth";
import { hashOAuthToken, MCP_RESOURCE_URL, newOAuthToken, oauthError, readOAuthBody } from "@/lib/mcp-oauth";

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
  const raw = await readOAuthBody(request);
  if (raw === null) return oauthError("invalid_request", "Request body is too large or invalid.", 413);
  const form = new URLSearchParams(raw);
  for (const name of new Set(form.keys())) if (form.getAll(name).length !== 1) return oauthError("invalid_request", "Duplicate parameters are not allowed.");
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

    try { if (!await isMcpOSAccountIdAllowed(authCode.user_id)) return oauthError("invalid_grant", "Account access is no longer available."); }
    catch { return oauthError("server_error", "Account verification unavailable.", 503); }

    const accessToken = newOAuthToken("mcpos_at_");
    const refreshToken = newOAuthToken("mcpos_rt_");
    const scopes = authCode.scopes as string[];
    const exchange = await supabaseRest("rpc/exchange_mcpos_oauth_code", {
      method: "POST",
      body: JSON.stringify({
        p_code_hash: codeHash, p_client_id: clientId, p_user_id: authCode.user_id,
        p_redirect_uri: redirectUri, p_resource: resource, p_challenge: calculatedChallenge,
        p_access_hash: hashOAuthToken(accessToken), p_refresh_hash: hashOAuthToken(refreshToken),
      }),
    });
    if (!exchange.ok) return oauthError("server_error", "Could not issue the session. Please retry.", 503);
    if (await exchange.json() !== true) return oauthError("invalid_grant", "The authorization code is expired, consumed, or invalid.");
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

  try { if (!await isMcpOSAccountIdAllowed(stored.user_id)) return oauthError("invalid_grant", "Account access is no longer available."); }
  catch { return oauthError("server_error", "Account verification unavailable.", 503); }

  const nextAccessToken = newOAuthToken("mcpos_at_");
  const nextRefreshToken = newOAuthToken("mcpos_rt_");
  const rotation = await supabaseRest("rpc/rotate_mcpos_oauth_refresh", {
    method: "POST",
    body: JSON.stringify({
      p_old_hash: refreshHash, p_client_id: clientId, p_user_id: stored.user_id,
      p_resource: resource, p_access_hash: hashOAuthToken(nextAccessToken),
      p_refresh_hash: hashOAuthToken(nextRefreshToken),
    }),
  });
  if (!rotation.ok) return oauthError("server_error", "Could not rotate the session. Please retry.", 503);
  if (await rotation.json() !== true) return oauthError("invalid_grant", "The refresh token is expired, revoked, already used, or no longer authorised.");
  return tokenResponse(nextAccessToken, nextRefreshToken, stored.scopes as string[]);
}
