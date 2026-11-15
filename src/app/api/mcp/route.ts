import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.MCP_BEARER_TOKEN;
  if (!expected || expected.length < 32) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const digest = (value: string) => createHmac("sha256", "mcpos-token-check").update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(expected));
}

function makeServer() {
  const server = new McpServer({ name: "mcpos-workspace", version: "0.1.0" });

  server.registerTool(
    "mcpos_status",
    {
      title: "McpOS status",
      description: "Get the non-sensitive status of the McpOS development workspace.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify({
        name: "McpOS",
        version: "0.1.0",
        mode: "foundation",
        executionEnabled: false,
        availableTools: ["mcpos_status", "mcpos_capabilities"],
      }, null, 2) }],
    }),
  );

  server.registerTool(
    "mcpos_capabilities",
    {
      title: "McpOS capabilities",
      description: "List enabled and planned workspace capabilities. This tool does not perform changes.",
      inputSchema: { includePlanned: z.boolean().optional() },
    },
    async ({ includePlanned }) => ({
      content: [{ type: "text", text: JSON.stringify({
        enabled: ["authenticated MCP endpoint", "workspace status", "capability discovery"],
        planned: includePlanned === false ? [] : [
          "GitHub repository browsing and pull request workflows",
          "AI coding tasks with explicit approval",
          "isolated terminal sessions",
          "browser preview and quality assurance",
          "deployment verification and rollback",
        ],
      }, null, 2) }],
    }),
  );

  return server;
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const server = makeServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch {
    await transport.close();
    await server.close();
    return NextResponse.json({ error: "MCP request failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
