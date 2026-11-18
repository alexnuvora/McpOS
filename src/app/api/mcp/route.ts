import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { supabaseRest } from "@/lib/device-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type McpClient = { id: string; user_id: string; client_name: string; scopes: string[]; revoked_at: string | null };

async function authenticateClient(request: NextRequest): Promise<McpClient | null> {
  const token = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !token.startsWith("mcpos_") || token.length < 40 || token.length > 128) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const response = await supabaseRest(
    `mcpos_mcp_clients?select=id,user_id,client_name,scopes,revoked_at&token_hash=eq.${tokenHash}&limit=1`,
  );
  if (!response.ok) throw new Error("McpOS client authentication service is unavailable.");
  const [client] = await response.json() as McpClient[];
  if (!client || client.revoked_at) return null;
  await supabaseRest(`mcpos_mcp_clients?id=eq.${client.id}&revoked_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  });
  return client;
}

function makeServer(client: McpClient) {
  const server = new McpServer({ name: "mcpos-workspace", version: "0.2.0" });

  server.registerTool(
    "mcpos_status",
    {
      title: "McpOS status",
      description: "Get the non-sensitive status of the authenticated McpOS workspace and the connected AI client.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify({
        name: "McpOS",
        version: "0.2.0",
        authenticatedClient: client.client_name,
        mode: "outbound-device-relay",
        executionEnabled: false,
        availableTools: ["mcpos_status", "mcpos_capabilities", "mcpos_list_devices", "mcpos_request_desktop_status", "mcpos_get_command_status"],
      }, null, 2) }],
    }),
  );

  server.registerTool(
    "mcpos_capabilities",
    {
      title: "McpOS capabilities",
      description: "List currently implemented and planned workspace capabilities. This tool does not perform changes.",
      inputSchema: z.object({ includePlanned: z.boolean().optional() }),
    },
    async ({ includePlanned }) => ({
      content: [{ type: "text", text: JSON.stringify({
        enabled: ["per-client bearer authentication", "workspace status", "capability discovery", "paired-device listing", "outbound command polling", "read-only desktop status request"],
        permissionGated: ["screen capture", "Windows accessibility", "mouse control", "keyboard input", "browser control", "approved-folder file access"],
        planned: includePlanned === false ? [] : [
          "consent and approval prompts",
          "screen capture and image return",
          "Windows UI Automation",
          "bounded mouse and keyboard actions",
          "isolated browser automation",
          "approved-folder file operations",
          "full OAuth authorization for compatible MCP clients",
        ],
      }, null, 2) }],
    }),
  );

  server.registerTool(
    "mcpos_list_devices",
    {
      title: "List paired devices",
      description: "List the authenticated user's paired McpOS devices. Returns device names and connection timestamps only; never returns device credentials.",
      inputSchema: z.object({}),
    },
    async () => {
      if (!client.scopes.includes("workspace.read")) return { content: [{ type: "text", text: "This MCP client does not have workspace.read permission." }], isError: true };
      const response = await supabaseRest(
        `mcpos_devices?select=id,device_name,platform,status,last_seen_at,paired_at&user_id=eq.${client.user_id}&status=neq.revoked&order=paired_at.desc`,
      );
      if (!response.ok) return { content: [{ type: "text", text: "Could not retrieve paired devices." }], isError: true };
      const devices = await response.json();
      return { content: [{ type: "text", text: JSON.stringify({ devices }, null, 2) }] };
    },
  );

  server.registerTool(
    "mcpos_request_desktop_status",
    {
      title: "Request desktop status",
      description: "Ask one online, paired Windows companion for a non-sensitive status snapshot. This is read-only. The device must have desktop.status enabled. Returns a command ID; call mcpos_get_command_status to retrieve the result.",
      inputSchema: z.object({ deviceId: z.string().uuid().optional() }),
    },
    async ({ deviceId }) => {
      if (!client.scopes.includes("desktop.status")) return { content: [{ type: "text", text: "This MCP client does not have desktop.status permission." }], isError: true };
      const filter = deviceId ? `&id=eq.${deviceId}` : "";
      const devicesResponse = await supabaseRest(
        `mcpos_devices?select=id,device_name,status&user_id=eq.${client.user_id}&status=eq.online${filter}&order=last_seen_at.desc&limit=1`,
      );
      if (!devicesResponse.ok) return { content: [{ type: "text", text: "Could not check device availability." }], isError: true };
      const [device] = await devicesResponse.json();
      if (!device) return { content: [{ type: "text", text: "No matching Windows device is currently online. Open the McpOS desktop companion and check its connection." }], isError: true };
      const permissionResponse = await supabaseRest(
        `mcpos_device_permissions?select=enabled&device_id=eq.${device.id}&capability=eq.desktop.status&limit=1`,
      );
      if (!permissionResponse.ok) return { content: [{ type: "text", text: "Could not verify the device permission." }], isError: true };
      const [permission] = await permissionResponse.json();
      if (!permission?.enabled) return { content: [{ type: "text", text: "The desktop.status capability is disabled for this device." }], isError: true };
      const expiresAt = new Date(Date.now() + 45_000).toISOString();
      const commandResponse = await supabaseRest("mcpos_device_commands", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          user_id: client.user_id,
          device_id: device.id,
          command: "desktop.status",
          payload: {},
          expires_at: expiresAt,
        }),
      });
      if (!commandResponse.ok) return { content: [{ type: "text", text: "Could not queue a desktop status request." }], isError: true };
      const [command] = await commandResponse.json();
      return { content: [{ type: "text", text: JSON.stringify({
        commandId: command.id,
        device: device.device_name,
        status: "queued",
        expiresAt,
        nextStep: "Call mcpos_get_command_status with this commandId to retrieve the desktop response.",
      }, null, 2) }] };
    },
  );

  server.registerTool(
    "mcpos_get_command_status",
    {
      title: "Get desktop command status",
      description: "Retrieve the result of a previously queued read-only desktop status request. Only commands belonging to the authenticated workspace are visible.",
      inputSchema: z.object({ commandId: z.string().uuid() }),
    },
    async ({ commandId }) => {
      const response = await supabaseRest(
        `mcpos_device_commands?select=id,command,status,result,error_message,created_at,expires_at,completed_at&user_id=eq.${client.user_id}&id=eq.${commandId}&limit=1`,
      );
      if (!response.ok) return { content: [{ type: "text", text: "Could not retrieve the command status." }], isError: true };
      const [command] = await response.json();
      if (!command) return { content: [{ type: "text", text: "Command not found for this workspace." }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(command, null, 2) }] };
    },
  );

  return server;
}

async function handle(request: NextRequest) {
  let client: McpClient | null;
  try {
    client = await authenticateClient(request);
  } catch (error) {
    console.error("McpOS MCP authentication error:", error);
    return NextResponse.json({ error: "McpOS authentication service is unavailable." }, { status: 503 });
  }
  if (!client) {
    return NextResponse.json(
      { error: "Unauthorized. Create an MCP client key in the McpOS dashboard." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const server = makeServer(client);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error("McpOS MCP request failed:", error);
    await transport.close();
    await server.close();
    return NextResponse.json({ error: "MCP request failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
