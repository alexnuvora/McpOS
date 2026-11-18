import { NextResponse } from "next/server";
import { MCP_ISSUER, MCP_SCOPES } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    issuer: MCP_ISSUER,
    authorization_endpoint: MCP_ISSUER + "/oauth/authorize",
    token_endpoint: MCP_ISSUER + "/oauth/token",
    registration_endpoint: MCP_ISSUER + "/oauth/register",
    revocation_endpoint: MCP_ISSUER + "/oauth/revoke",
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...MCP_SCOPES],
    client_id_metadata_document_supported: false,
    authorization_response_iss_parameter_supported: false,
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
