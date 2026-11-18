import { NextResponse } from "next/server";
import { MCP_ISSUER, MCP_RESOURCE_URL, MCP_SCOPES } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    resource: MCP_RESOURCE_URL,
    authorization_servers: [MCP_ISSUER],
    scopes_supported: [...MCP_SCOPES],
    resource_documentation: "https://github.com/alexnuvora/McpOS/blob/main/docs/MCP_CLIENT_SETUP.md",
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
