import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

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


async function sendDesktopCommand(deviceId: string, command: string, args: Record<string, unknown>) {
  const relayUrl = process.env.MCPOS_RELAY_URL ?? "http://relay:8080";
  const relaySecret = process.env.MCPOS_RELAY_SECRET;
  if (!relaySecret || relaySecret.length < 32) {
    throw new Error("McpOS relay is not configured on the server.");
  }
  const response = await fetch((relayUrl.endsWith("/") ? relayUrl.slice(0, -1) : relayUrl) + "/internal/command", {
    method: "POST",
    headers: {
      authorization: "Bearer " + relaySecret,
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify({ deviceId, command, args }),
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Desktop relay returned " + response.status + ".");
  }
  return payload.result;
}

function makeServer() {
  const server = new McpServer({ name: "mcpos-workspace", version: "0.1.0" });

  server.registerTool(
    "mcpos_status",
    {
      title: "McpOS status",
      description: "Get the non-sensitive status of the McpOS development workspace.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify({
        name: "McpOS",
        version: "0.1.0",
        mode: "desktop-control-foundation",
        executionEnabled: false,
        desktopControlEnabled: true,
        availableTools: ["mcpos_status", "mcpos_capabilities", "mcpos_desktop"],
      }, null, 2) }],
    }),
  );

  server.registerTool(
    "mcpos_capabilities",
    {
      title: "McpOS capabilities",
      description: "List enabled and planned workspace capabilities. This tool does not perform changes.",
      inputSchema: z.object({ includePlanned: z.boolean().optional() }),
    },
    async ({ includePlanned }) => ({
      content: [{ type: "text", text: JSON.stringify({
        enabled: ["authenticated MCP endpoint", "workspace status", "capability discovery", "desktop MCP tool implemented", "Windows accessibility inspection", "permission-gated screen capture and input (relay deployment required)"],
        planned: includePlanned === false ? [] : [
          "Oracle relay deployment and end-to-end connection verification",
          "GitHub repository browsing and pull request workflows",
          "AI coding tasks with explicit approval",
          "isolated terminal sessions",
          "browser preview and quality assurance",
          "deployment verification and rollback",
        ],
      }, null, 2) }],
    }),
  );


  server.registerTool(
    "mcpos_desktop",
    {
      title: "Control a paired McpOS desktop",
      description: "Request a screen capture, inspect an application's Windows accessibility tree, or perform a mouse/keyboard action on a paired desktop. The desktop must be online and the local user must have enabled the relevant permission and approve each action in the desktop app.",
      inputSchema: z.object({
        deviceId: z.string().min(8).max(80),
        action: z.enum(["capture_screen", "inspect_application", "click_application", "type_application_text", "press_application_key"]),
        appName: z.string().max(128).optional(),
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
        text: z.string().max(4000).optional(),
        key: z.string().max(64).optional(),
      }),
    },
    async ({ deviceId, action, appName, x, y, text, key }) => {
      const commandArgs: Record<string, unknown> = {};
      if (action !== "capture_screen") {
        if (!appName?.trim()) throw new Error("appName is required for this action.");
        commandArgs.appName = appName.trim();
      }
      if (action === "click_application") {
        if (typeof x !== "number" || typeof y !== "number") throw new Error("x and y screen coordinates are required.");
        commandArgs.x = x;
        commandArgs.y = y;
      }
      if (action === "type_application_text") {
        if (typeof text !== "string") throw new Error("text is required.");
        commandArgs.value = text;
      }
      if (action === "press_application_key") {
        if (!key?.trim()) throw new Error("key is required.");
        commandArgs.key = key;
      }
      const result = await sendDesktopCommand(deviceId, action, commandArgs);
      if (action === "capture_screen" && typeof result === "string" && result.startsWith("data:image/png;base64,")) {
        return {
          content: [
            { type: "image" as const, data: result.slice("data:image/png;base64,".length), mimeType: "image/png" },
            { type: "text" as const, text: "Screen capture returned by the paired desktop after local approval." },
          ],
        };
      }
      return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result ?? null, null, 2) }] };
    },
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
