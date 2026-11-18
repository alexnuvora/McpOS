import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";
import { MCP_RESOURCE_URL, parseScopes } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const clientId = q.get("client_id") || "";
  const redirectUri = q.get("redirect_uri") || "";
  const responseType = q.get("response_type");
  const challenge = q.get("code_challenge") || "";
  const challengeMethod = q.get("code_challenge_method");
  const resource = q.get("resource") || "";
  const scopes = parseScopes(q.get("scope"));

  if (!clientId || responseType !== "code" || !/^[-_A-Za-z0-9]{43,128}$/.test(challenge) || challengeMethod !== "S256" || resource !== MCP_RESOURCE_URL || !scopes) {
    return NextResponse.json({ error: "invalid_request", error_description: "The OAuth request is missing required PKCE, resource or scope parameters." }, { status: 400 });
  }

  const clientResponse = await supabaseRest(`mcpos_oauth_clients?select=client_id,client_name,redirect_uris&client_id=eq.${encodeURIComponent(clientId)}&limit=1`);
  if (!clientResponse.ok) return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });
  const [client] = await clientResponse.json();
  if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri)) {
    return NextResponse.json({ error: "invalid_client", error_description: "The client or redirect URI is not registered." }, { status: 400 });
  }

  const account = await getDeviceAccount(request);
  if ("response" in account) {
    if (account.response.status !== 401) return account.response;
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  const authRequest = {
    clientId,
    clientName: String(client.client_name),
    redirectUri,
    challenge,
    resource,
    scopes,
    state: q.get("state") || "",
  };
  const encoded = Buffer.from(JSON.stringify(authRequest)).toString("base64url");
  const consent = new URL("/oauth/consent", request.url);
  consent.searchParams.set("request", encoded);
  return NextResponse.redirect(consent);
}
