import { randomBytes, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount, supabaseRest } from "@/lib/device-auth";
import { MCP_RESOURCE_URL, MCP_SCOPES } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

type ConsentRequest = { clientId: string; redirectUri: string; challenge: string; resource: string; scopes: string[]; state?: string };

export async function POST(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  let body: { request?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid consent request." }, { status: 400 }); }
  if (typeof body.request !== "string" || body.request.length > 8000) return NextResponse.json({ error: "Invalid consent request." }, { status: 400 });

  let grant: ConsentRequest;
  try { grant = JSON.parse(Buffer.from(body.request, "base64url").toString("utf8")); }
  catch { return NextResponse.json({ error: "Invalid consent request." }, { status: 400 }); }
  if (!grant || typeof grant.clientId !== "string" || typeof grant.redirectUri !== "string" ||
      typeof grant.challenge !== "string" || !/^[-_A-Za-z0-9]{43,128}$/.test(grant.challenge) ||
      grant.resource !== MCP_RESOURCE_URL || !Array.isArray(grant.scopes) ||
      grant.scopes.some(scope => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) {
    return NextResponse.json({ error: "The requested permissions or resource are invalid." }, { status: 400 });
  }

  const clientResponse = await supabaseRest(`mcpos_oauth_clients?select=client_id,client_name,redirect_uris&client_id=eq.${encodeURIComponent(grant.clientId)}&limit=1`);
  if (!clientResponse.ok) return NextResponse.json({ error: "OAuth service is temporarily unavailable." }, { status: 503 });
  const [client] = await clientResponse.json();
  if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(grant.redirectUri)) {
    return NextResponse.json({ error: "The OAuth client or redirect URI is no longer valid." }, { status: 400 });
  }

  const code = randomBytes(32).toString("base64url");
  const codeHash = createHash("sha256").update(code).digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const inserted = await supabaseRest("mcpos_oauth_codes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      code_hash: codeHash,
      client_id: grant.clientId,
      user_id: auth.account.userId,
      redirect_uri: grant.redirectUri,
      code_challenge: grant.challenge,
      resource: grant.resource,
      scopes: grant.scopes,
      expires_at: expiresAt,
    }),
  });
  if (!inserted.ok) return NextResponse.json({ error: "Could not create the authorisation code." }, { status: 503 });

  await supabaseRest("mcpos_device_audit", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: auth.account.userId, event_type: "mcp.oauth.authorized", outcome: "success", metadata: { client_name: client.client_name, scopes: grant.scopes } }),
  });

  const redirect = new URL(grant.redirectUri);
  redirect.searchParams.set("code", code);
  if (typeof grant.state === "string" && grant.state) redirect.searchParams.set("state", grant.state);
  return NextResponse.json({ redirectUrl: redirect.toString() }, { headers: { "Cache-Control": "no-store" } });
}
