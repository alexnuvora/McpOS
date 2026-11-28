import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { isMcpOSAccountIdAllowed, supabaseRest } from "@/lib/device-auth";
import { checkCommandEntitlement } from "@/lib/billing-entitlement";
import { MCP_RESOURCE_URL, MCP_ISSUER } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type McpClient = { id: string; user_id: string; client_name: string; scopes: string[]; revoked_at: string | null; token_expires_at?: string | null; token_resource?: string | null; last_used_at?: string | null };

async function authenticateClient(request: NextRequest): Promise<McpClient | null> {
  const token = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !token.startsWith("mcpos_") || token.length < 40 || token.length > 128) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const response = await supabaseRest(
    `mcpos_mcp_clients?select=id,user_id,client_name,scopes,revoked_at,token_expires_at,token_resource,last_used_at&token_hash=eq.${tokenHash}&limit=1`,
  );
  if (!response.ok) throw new Error("McpOS client authentication service is unavailable.");
  const [client] = await response.json() as McpClient[];
  if (!client || client.revoked_at || (client.token_expires_at && (!Number.isFinite(Date.parse(client.token_expires_at)) || Date.parse(client.token_expires_at) <= Date.now())) || (client.token_resource && client.token_resource !== MCP_RESOURCE_URL)) return null;
  if (!await isMcpOSAccountIdAllowed(client.user_id)) return null;
  const cutoff = new Date(Date.now() - 300_000).toISOString();
  if (!client.last_used_at || Date.parse(client.last_used_at) < Date.parse(cutoff)) {
    try { await supabaseRest(`mcpos_mcp_clients?id=eq.${client.id}&revoked_at=is.null&or=(last_used_at.is.null,last_used_at.lt.${cutoff})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_used_at: new Date().toISOString() }) }); } catch { /* Activity tracking must not interrupt authentication. */ }
  }
  return client;
}

function permittedBrowserUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/\.+$/, "").toLowerCase();
    const reserved = ["localhost", "local", "internal", "home.arpa", "lan", "corp", "test", "invalid", "onion"];
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || host.length > 253 ||
        !host.includes(".") || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(":") ||
        reserved.some(suffix => host === suffix || host.endsWith("." + suffix)) ||
        !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
    return true;
  } catch { return false; }
}

function scopeError(scope: string) {
  return {
    content: [{ type: "text" as const, text: "This McpOS connection needs the " + scope + " permission. Reconnect and approve that permission to continue." }],
    isError: true,
    _meta: {
      "mcp/www_authenticate": [
        'Bearer resource_metadata="' + MCP_ISSUER + '/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Additional McpOS permission required: ' + scope + '."'
      ],
    },
  };
}
async function queueError(response: Response) {
  const error = await response.json().catch(() => null);
  const message = error?.code === "P0001" && error?.message === "mcpos_daily_command_limit"
    ? "Your daily McpOS command allowance has been reached. It resets at midnight UTC. View your usage in the billing dashboard."
    : error?.code === "P0001" && error?.message === "mcpos_billing_verification_expired"
      ? "The subscription verification window expired. Request a fresh command."
      : "Could not queue the desktop command. No command was accepted.";
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function makeServer(client: McpClient) {
  const server = new McpServer({ name: "mcpos-workspace", version: "0.2.0" });

  server.registerTool(
    "mcpos_status",
    {
      title: "McpOS status",
      description: "Get the non-sensitive status of the authenticated McpOS workspace and the connected AI client.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["workspace.read"] }] },
      inputSchema: z.object({}),
    },
    async () => {
      if (!client.scopes.includes("workspace.read")) return scopeError("workspace.read");
      return { content: [{ type: "text" as const, text: JSON.stringify({
        name: "McpOS",
        version: "0.2.0",
        authenticatedClient: client.client_name,
        mode: "outbound-device-relay",
        executionMode: "permission-gated",
        availableTools: ["mcpos_execute_task", "mcpos_get_task_status", "mcpos_cancel_task", "mcpos_status", "mcpos_capabilities", "mcpos_list_devices", "mcpos_request_desktop_status", "mcpos_capture_screen", "mcpos_get_accessibility_snapshot", "mcpos_access_approved_files", "mcpos_request_input_action", "mcpos_browser_automation", "mcpos_get_command_status", "mcpos_profile", "mcpos_get_audit_history"],
      }, null, 2) }] };
    },
  );

  server.registerTool(
    "mcpos_capabilities",
    {
      title: "McpOS capabilities",
      description: "List currently implemented and planned workspace capabilities. This tool does not perform changes.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["workspace.read"] }] },
      inputSchema: z.object({ includePlanned: z.boolean().optional() }),
    },
    async ({ includePlanned }) => {
      if (!client.scopes.includes("workspace.read")) return scopeError("workspace.read");
      return {
      content: [{ type: "text", text: JSON.stringify({
        enabled: ["per-client bearer authentication", "workspace status", "capability discovery", "paired-device listing", "outbound command polling", "read-only desktop status request", "one-shot JPEG screen capture", "bounded read-only Windows application discovery", "read-only approved-folder text access", "one-shot pointer and text-entry actions with local approval", "isolated browser navigation and selector automation", "paginated audit history and session revocation", "OAuth 2.1 authorization-code with PKCE and rotating refresh tokens"],
        permissionGated: ["screen capture local switch", "Windows accessibility local switch", "native folder-picker grants", "fresh local approval for every input action", "isolated browser local switch and fresh approval for navigation/click/type"],
        desktop023: ["ordered MCP tasks and task progress", "optional screenshots after actions", "snapshot-bound browser elements and same-origin frames", "native window controls and browser shortcuts", "clipboard writes", "application launching and focus", "locally selected browser file transfers", "per-task action permissions", "WebSocket relay with HTTP fallback", "multi-monitor capture and pointer coordinates"],
        planned: includePlanned === false ? [] : [
          "full accessibility-tree inspection",
          "file writes and deletes",
          "sandboxed terminal",
        ],
      }, null, 2) }] };
    },
  );

  server.registerTool(
    "mcpos_list_devices",
    {
      title: "List paired devices",
      description: "List the authenticated user's paired McpOS devices. Returns device names and connection timestamps only; never returns device credentials.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["workspace.read"] }] },
      inputSchema: z.object({}),
    },
    async () => {
      if (!client.scopes.includes("workspace.read")) return scopeError("workspace.read");
      const response = await supabaseRest(
        `mcpos_devices?select=id,device_name,platform,status,last_seen_at,paired_at&user_id=eq.${client.user_id}&status=neq.revoked&order=paired_at.desc`,
      );
      if (!response.ok) return { content: [{ type: "text", text: "Could not retrieve paired devices." }], isError: true };
      const devices = (await response.json() as Array<{ status: string; last_seen_at: string | null }>).map(device => ({ ...device, status: device.status === "online" && (!device.last_seen_at || !Number.isFinite(Date.parse(device.last_seen_at)) || Date.now() - Date.parse(device.last_seen_at) > 90_000) ? "offline" : device.status }));
      return { content: [{ type: "text", text: JSON.stringify({ devices }, null, 2) }] };
    },
  );

  server.registerTool(
    "mcpos_request_desktop_status",
    {
      title: "Request desktop status",
      description: "Ask one online, paired Windows companion for a non-sensitive status snapshot. This is read-only. The device must have desktop.status enabled. Returns a command ID; call mcpos_get_command_status to retrieve the result.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["desktop.status"] }] },
      inputSchema: z.object({ deviceId: z.string().uuid().optional() }),
    },
    async ({ deviceId }) => {
      if (!client.scopes.includes("desktop.status")) return scopeError("desktop.status");
      const entitlement = await checkCommandEntitlement(client.user_id);
      if (entitlement.status !== "allowed") return { content: [{ type: "text" as const, text: entitlement.status === "subscription_required" ? "An active McpOS subscription is required to request desktop commands. Manage your plan in the McpOS dashboard." : "Subscription verification is temporarily unavailable. No desktop command was queued." }], isError: true };
      const filter = deviceId ? `&id=eq.${deviceId}` : "";
      const recentCutoff = new Date(Date.now() - 90_000).toISOString();
      const devicesResponse = await supabaseRest(
        `mcpos_devices?select=id,device_name,status,last_seen_at&user_id=eq.${client.user_id}&status=eq.online&last_seen_at=gte.${recentCutoff}${filter}&order=last_seen_at.desc&limit=1`,
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
          mcp_client_id: client.id, ...entitlement.billing,
          device_id: device.id,
          command: "desktop.status",
          payload: {},
          expires_at: expiresAt,
        }),
      });
      if (!commandResponse.ok) return queueError(commandResponse);
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
    "mcpos_capture_screen",
    {
      title: "Capture Windows screen",
      description: "Request one JPEG screenshot from the paired Windows computer. Requires the screen.capture scope and either the visible local screen-capture consent switch or an active Windows automation session that explicitly allows captures. With an updated companion, use listDisplays to enumerate monitor IDs or displayId to capture one monitor. Defaults to the primary monitor.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["screen.capture"] }] },
      inputSchema: z.object({ deviceId: z.string().uuid().optional(), listDisplays: z.boolean().optional(), displayId: z.number().int().nonnegative().optional() }),
    },
    async ({ deviceId, listDisplays, displayId }) => {
      if (!client.scopes.includes("screen.capture")) return scopeError("screen.capture");
      const entitlement = await checkCommandEntitlement(client.user_id);
      if (entitlement.status !== "allowed") return { content: [{ type: "text" as const, text: entitlement.status === "subscription_required" ? "An active McpOS subscription is required to request desktop commands. Manage your plan in the McpOS dashboard." : "Subscription verification is temporarily unavailable. No desktop command was queued." }], isError: true };
      const filter = deviceId ? `&id=eq.${deviceId}` : "";
      const recentCutoff = new Date(Date.now() - 90_000).toISOString();
      const devicesResponse = await supabaseRest(`mcpos_devices?select=id,device_name,status,last_seen_at,relay_version&user_id=eq.${client.user_id}&status=eq.online&last_seen_at=gte.${recentCutoff}${filter}&order=last_seen_at.desc&limit=1`);
      if (!devicesResponse.ok) return { content: [{ type: "text", text: "Could not check device availability." }], isError: true };
      const [device] = await devicesResponse.json();
      if (!device) return { content: [{ type: "text", text: "No matching Windows device is currently online." }], isError: true };
      if ((listDisplays || displayId !== undefined) && device.relay_version < 3) return { isError: true, content: [{ type: "text", text: "Monitor selection requires McpOS Desktop 0.2.3 or later." }] };
      const expiresAt = new Date(Date.now() + 45_000).toISOString();
      const commandResponse = await supabaseRest("mcpos_device_commands", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ user_id: client.user_id, mcp_client_id: client.id, ...entitlement.billing, device_id: device.id, command: "screen.capture", payload: { display: "primary", listDisplays, displayId, max_bytes: 4_000_000 }, expires_at: expiresAt }),
      });
      if (!commandResponse.ok) return queueError(commandResponse);
      const [command] = await commandResponse.json();
      await supabaseRest("mcpos_device_audit", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: client.user_id, device_id: device.id, event_type: "screen.capture.requested", outcome: "success", metadata: { command_id: command.id, client_name: client.client_name } }),
      });
      return { content: [{ type: "text", text: JSON.stringify({ commandId: command.id, device: device.device_name, status: "queued", consentRequired: "Enable the local screen-capture switch, or start an active Windows automation session that explicitly allows screen captures.", nextStep: "Call mcpos_get_command_status with this commandId to retrieve the screenshot." }, null, 2) }] };
    },
  );
  server.registerTool(
    "mcpos_get_accessibility_snapshot",
    {
      title: "Understand open Windows applications",
      description: "Read a bounded Windows UI Automation snapshot of windows and the focused or explicitly targeted application’s control labels on updated companions. Requires the screen.accessibility scope on this AI client and the visible local application-understanding switch to be ON. Password control labels are excluded.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["screen.accessibility"] }] },
      inputSchema: z.object({ deviceId: z.string().uuid().optional(), windowId: z.array(z.number().int()).min(1).max(32).optional() }),
    },
    async ({ deviceId, windowId }) => {
      if (!client.scopes.includes("screen.accessibility")) return scopeError("screen.accessibility");
      const entitlement = await checkCommandEntitlement(client.user_id);
      if (entitlement.status !== "allowed") return { content: [{ type: "text" as const, text: entitlement.status === "subscription_required" ? "An active McpOS subscription is required to request desktop commands. Manage your plan in the McpOS dashboard." : "Subscription verification is temporarily unavailable. No desktop command was queued." }], isError: true };
      const filter = deviceId ? `&id=eq.${deviceId}` : "";
      const recentCutoff = new Date(Date.now() - 90_000).toISOString();
      const devicesResponse = await supabaseRest(`mcpos_devices?select=id,device_name,status,last_seen_at&user_id=eq.${client.user_id}&status=eq.online&last_seen_at=gte.${recentCutoff}${filter}&order=last_seen_at.desc&limit=1`);
      if (!devicesResponse.ok) return { content: [{ type: "text", text: "Could not check device availability." }], isError: true };
      const [device] = await devicesResponse.json();
      if (!device) return { content: [{ type: "text", text: "No matching Windows device is currently online." }], isError: true };
      const expiresAt = new Date(Date.now() + 45_000).toISOString();
      const commandResponse = await supabaseRest("mcpos_device_commands", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ user_id: client.user_id, mcp_client_id: client.id, ...entitlement.billing, device_id: device.id, command: "desktop.accessibility", payload: { scope: "top_level_windows", max_items: 40, ...(windowId ? { windowId } : {}) }, expires_at: expiresAt }),
      });
      if (!commandResponse.ok) return queueError(commandResponse);
      const [command] = await commandResponse.json();
      await supabaseRest("mcpos_device_audit", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: client.user_id, device_id: device.id, event_type: "desktop.accessibility.requested", outcome: "success", metadata: { command_id: command.id, client_name: client.client_name } }),
      });
      return { content: [{ type: "text", text: JSON.stringify({ commandId: command.id, device: device.device_name, status: "queued", localConsentRequired: "The Windows application-understanding switch must be ON.", nextStep: "Call mcpos_get_command_status with this commandId to retrieve the snapshot." }, null, 2) }] };
    },
  );
  server.registerTool(
    "mcpos_access_approved_files",
    {
      title: "Access locally approved files",
      description: "List locally approved folders, list a folder, or read a small UTF-8 text file. Requires files.read scope. The Windows companion rejects paths outside folders explicitly selected in its local UI. No file writes, deletes, or uploads are supported.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["files.read"] }] },
      inputSchema: z.object({ operation: z.enum(["list_folders", "list", "read"]), path: z.string().max(2048).optional() }),
    },
    async ({ operation, path }) => {
      if (!client.scopes.includes("files.read")) return scopeError("files.read");
      const entitlement = await checkCommandEntitlement(client.user_id);
      if (entitlement.status !== "allowed") return { content: [{ type: "text" as const, text: entitlement.status === "subscription_required" ? "An active McpOS subscription is required to request desktop commands. Manage your plan in the McpOS dashboard." : "Subscription verification is temporarily unavailable. No desktop command was queued." }], isError: true };
      if (operation !== "list_folders" && !path?.trim()) return { content: [{ type: "text", text: "A path is required for this operation." }], isError: true };
      const recentCutoff = new Date(Date.now() - 90_000).toISOString();
      const devicesResponse = await supabaseRest(`mcpos_devices?select=id,device_name&user_id=eq.${client.user_id}&status=eq.online&last_seen_at=gte.${recentCutoff}&order=last_seen_at.desc&limit=1`);
      if (!devicesResponse.ok) return { content: [{ type: "text", text: "Could not check device availability." }], isError: true };
      const [device] = await devicesResponse.json();
      if (!device) return { content: [{ type: "text", text: "No online Windows device is available." }], isError: true };
      const command = operation === "read" ? "files.read" : "files.list";
      const payload = operation === "list_folders" ? {} : { path };
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const queued = await supabaseRest("mcpos_device_commands", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: client.user_id, mcp_client_id: client.id, ...entitlement.billing, device_id: device.id, command, payload, expires_at: expiresAt }) });
      if (!queued.ok) return queueError(queued);
      const [row] = await queued.json();
      await supabaseRest("mcpos_device_audit", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: client.user_id, device_id: device.id, event_type: "files." + operation + ".requested", outcome: "success", metadata: { command_id: row.id, client_name: client.client_name } }) });
      return { content: [{ type: "text", text: JSON.stringify({ commandId: row.id, operation, path: path ?? null, status: "queued", localApproval: "The Windows computer must be online and the path must be inside a folder selected in its local McpOS UI.", nextStep: "Call mcpos_get_command_status with this commandId." }, null, 2) }] };
    },
  );
  server.registerTool(
    "mcpos_request_input_action",
    {
      title: "Request an approved mouse or keyboard action",
      description: "Queue a bounded pointer click, text-entry action or allowlisted keyboard shortcut. The Windows computer enforces its local Manual, Selected or Auto-approve-all policy; Auto mode never grants destructive file operations.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["input.pointer","input.keyboard"] }] },
      inputSchema: z.object({ action: z.enum(["pointer_click", "pointer_move", "pointer_scroll", "keyboard_type", "keyboard_shortcut"]), x: z.number().int().min(-32768).max(32767).optional(), y: z.number().int().min(-32768).max(32767).optional(), button: z.enum(["left", "right"]).optional(), steps: z.number().int().min(-12).max(12).optional(), axis: z.enum(["vertical", "horizontal"]).optional(), text: z.string().max(200).optional(), keys: z.array(z.string().max(12)).min(2).max(4).optional() }),
    },
    async ({ action, x, y, button, steps, axis, text, keys }) => {
      const command = action === "pointer_click" ? "input.pointer.click" : action === "pointer_move" ? "input.pointer.move" : action === "pointer_scroll" ? "input.pointer.scroll" : action === "keyboard_type" ? "input.keyboard.type" : "input.keyboard.shortcut";
      const requiredScope = action.startsWith("pointer_") ? "input.pointer" : "input.keyboard";
      if (!client.scopes.includes(requiredScope)) return scopeError(requiredScope);
      const entitlement = await checkCommandEntitlement(client.user_id);
      if (entitlement.status !== "allowed") return { content: [{ type: "text" as const, text: entitlement.status === "subscription_required" ? "An active McpOS subscription is required to request desktop commands. Manage your plan in the McpOS dashboard." : "Subscription verification is temporarily unavailable. No desktop command was queued." }], isError: true };
      if ((action === "pointer_click" || action === "pointer_move") && (x === undefined || y === undefined)) return { content: [{ type: "text", text: "Both x and y coordinates are required for a click." }], isError: true };
      if (action === "pointer_scroll" && steps === undefined) return { content: [{ type: "text", text: "Scroll steps are required." }], isError: true };
      if (action === "keyboard_type" && (!text || !text.length || /[\u0000-\u001f\u007f]/.test(text))) return { content: [{ type: "text", text: "Text must be 1–200 printable characters." }], isError: true };
      if (action === "keyboard_shortcut" && (!keys || keys.length < 2 || keys.length > 4)) return { content: [{ type: "text", text: "A keyboard shortcut must contain 2–4 allowlisted keys." }], isError: true };
      const recentCutoff = new Date(Date.now() - 90_000).toISOString();
      const devicesResponse = await supabaseRest(`mcpos_devices?select=id,device_name&user_id=eq.${client.user_id}&status=eq.online&last_seen_at=gte.${recentCutoff}&order=last_seen_at.desc&limit=1`);
      if (!devicesResponse.ok) return { content: [{ type: "text", text: "Could not check device availability." }], isError: true };
      const [device] = await devicesResponse.json();
      if (!device) return { content: [{ type: "text", text: "No online Windows device is available." }], isError: true };
      const payload = action === "pointer_click" ? { x, y, button: button ?? "left" } : action === "pointer_move" ? { x, y } : action === "pointer_scroll" ? { steps, axis: axis ?? "vertical" } : action === "keyboard_type" ? { text } : { keys };
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const queued = await supabaseRest("mcpos_device_commands", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: client.user_id, mcp_client_id: client.id, ...entitlement.billing, device_id: device.id, command, payload, expires_at: expiresAt }) });
      if (!queued.ok) return queueError(queued);
      const [row] = await queued.json();
      await supabaseRest("mcpos_device_audit", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: client.user_id, device_id: device.id, event_type: command + ".requested", outcome: "success", metadata: { command_id: row.id, client_name: client.client_name } }) });
      return { content: [{ type: "text", text: JSON.stringify({ commandId: row.id, action, status: "queued", device: device.device_name, approval: "The Windows companion enforces its local Manual, Selected or AUTO policy. Manual or non-selected actions require a fresh local approval; active AUTO permissions may execute automatically.", nextStep: "Call mcpos_get_command_status after the user approves or denies." }, null, 2) }] };
    },
  );
  server.registerTool(
    "mcpos_browser_automation",
    {
      title: "Automate the isolated browser",
      description: "Open an HTTPS website (newWindow optionally opens another window on supported companions), read a bounded page snapshot, click a returned snapshot-bound elementId (pass it as selector) or CSS selector, or enter text into a selected field in the separate McpOS browser profile. List windows, switch or close by windowId, and target snapshots, clicks and typing with the exact windowId. Requires Desktop 0.2.2 for window IDs and management. Requires browser.control scope and the local browser consent switch. The Windows computer enforces its local Manual, Selected or Auto-approve-all policy. Browser automation always retains its separate local consent switch.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["browser.control"] }] },
      inputSchema: z.object({ action: z.enum(["open", "snapshot", "click", "type", "upload", "list", "switch", "close"]), expectedText: z.string().trim().min(1).max(200).optional().describe("For click: require this new visible confirmation text after dispatch."), url: z.string().max(2048).optional(), selector: z.string().max(256).optional(), text: z.string().max(200).optional(), newWindow: z.boolean().optional(), windowId: z.string().regex(/^mcpos-isolated-browser-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional() }),
    },
    async ({ action, url, selector, text, newWindow, windowId, expectedText }) => {
      if (!client.scopes.includes("browser.control")) return scopeError("browser.control");
      const entitlement = await checkCommandEntitlement(client.user_id);
      if (entitlement.status !== "allowed") return { content: [{ type: "text" as const, text: entitlement.status === "subscription_required" ? "An active McpOS subscription is required to request desktop commands. Manage your plan in the McpOS dashboard." : "Subscription verification is temporarily unavailable. No desktop command was queued." }], isError: true };
      if ((action === "switch" || action === "close") && !windowId) return { content: [{ type: "text", text: "A windowId returned by list is required." }], isError: true };
      if (action === "upload" && !selector?.startsWith("mcpos:")) return { isError: true, content: [{ type: "text", text: "Choose a snapshot-bound file input. Windows will prompt for the local file." }] };
      if (newWindow && windowId) return { content: [{ type: "text", text: "Choose either newWindow or a specific windowId." }], isError: true };
      if (action === "open") {
        if (!url) return { content: [{ type: "text", text: "A URL is required." }], isError: true };
        if (!permittedBrowserUrl(url)) return { content: [{ type: "text", text: "Only valid public HTTPS URLs without embedded credentials are allowed." }], isError: true };
      }
      if ((action === "click" || action === "type") && !selector?.trim()) return { content: [{ type: "text", text: "A CSS selector is required." }], isError: true };
      if (action === "type" && (!text || !text.length || /[\u0000-\u001f\u007f]/.test(text))) return { content: [{ type: "text", text: "Text must be 1–200 printable characters." }], isError: true };
      const recentCutoff = new Date(Date.now() - 90_000).toISOString();
      const devicesResponse = await supabaseRest(`mcpos_devices?select=id,device_name&user_id=eq.${client.user_id}&status=eq.online&last_seen_at=gte.${recentCutoff}&order=last_seen_at.desc&limit=1`);
      if (!devicesResponse.ok) return { content: [{ type: "text", text: "Could not check device availability." }], isError: true };
      const [device] = await devicesResponse.json();
      if (!device) return { content: [{ type: "text", text: "No online Windows device is available." }], isError: true };
      // Use the existing approved browser.open relay envelope for v2 window operations.
      // Older agents reject the missing URL instead of accidentally acting on the wrong window.
      if (expectedText && action !== "click") return { isError: true, content: [{ type: "text", text: "expectedText applies to clicks." }] };
      const targeted = Boolean(expectedText) || Boolean(windowId) || ["list","switch","close","upload"].includes(action);
      const command = targeted ? "browser.open" : "browser." + action;
      const payload = targeted ? { windowAction: expectedText ? "browser.verified_click" : "browser." + action, expectedText, windowId, ...(action === "open" ? { targetUrl: url } : {}), ...(["click","type","upload"].includes(action) ? { selector } : {}), ...(action === "type" ? { text } : {}) } : action === "open" ? { url, ...(newWindow === true ? { newWindow: true } : {}) } : action === "click" ? { selector } : action === "type" ? { selector, text } : {};
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const queued = await supabaseRest("mcpos_device_commands", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: client.user_id, mcp_client_id: client.id, ...entitlement.billing, device_id: device.id, command, payload, expires_at: expiresAt }) });
      if (!queued.ok) return queueError(queued);
      const [row] = await queued.json();
      await supabaseRest("mcpos_device_audit", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: client.user_id, device_id: device.id, event_type: command + ".requested", outcome: "success", metadata: { command_id: row.id, client_name: client.client_name, browser_action: action } }) });
      return { content: [{ type: "text", text: JSON.stringify({ commandId: row.id, action, status: action === "snapshot" && !targeted ? "queued" : "awaiting_local_approval", device: device.device_name, localConsent: "The isolated browser switch must be ON on the Windows computer.", approval: action === "snapshot" && !targeted ? "Read-only snapshot; no click or input is performed." : "The Windows companion enforces its local Manual, Selected or AUTO policy; browser consent remains separately required.", nextStep: "Call mcpos_get_command_status with this commandId." }, null, 2) }] };
    },
  );
  async function readCommand(commandId: string) {
      if (!client.scopes.includes("workspace.read")) return scopeError("workspace.read");
      const response = await supabaseRest("rpc/consume_mcpos_command_result", {
        method: "POST", body: JSON.stringify({ p_user_id: client.user_id, p_client_id: client.id, p_command_id: commandId }),
      });
      if (!response.ok) return { content: [{ type: "text" as const, text: "Could not retrieve the command status." }], isError: true };
      const command = await response.json();
      if (!command) return { content: [{ type: "text" as const, text: "Command not found or no longer authorized for this workspace." }], isError: true };
      if (command.status === "completed" && command.result && command.result.consumed !== true) {
        const result = command.result;
        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
        const metadata = { ...command };
        delete metadata.result;
        if (command.command === "screen.capture" && typeof result.image_base64 === "string") {
          const { image_base64, ...imageMetadata } = result;
          content.push({ type: "text" as const, text: JSON.stringify({ ...metadata, result: imageMetadata }, null, 2) });
          content.push({ type: "image", data: image_base64, mimeType: "image/jpeg" });
        } else {
          content.push({ type: "text" as const, text: JSON.stringify(command, null, 2) });
        }
        await supabaseRest("mcpos_device_audit", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: client.user_id, device_id: command.device_id, event_type: "mcp.command.result_consumed", outcome: "success", metadata: { command_id: command.id, client_name: client.client_name } }) });
        return { content };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(command, null, 2) }] };
  }
  server.registerTool(
    "mcpos_get_command_status",
    {
      title: "Get desktop command status",
      description: "Retrieve the status and one-time result of a previously queued desktop request. Only commands belonging to this authenticated AI client are visible. Completed results expire after 15 minutes.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["workspace.read"] }] },
      inputSchema: z.object({ commandId: z.string().uuid() }),
    },
    ({ commandId }) => readCommand(commandId),
  );

  server.registerTool(
    "mcpos_profile",
    {
      title: "Authenticated McpOS profile",
      description: "Return the stable McpOS workspace identity associated with this OAuth or API-key connection. The opaque ID remains stable across token refreshes.",
      inputSchema: z.object({}),
      outputSchema: z.object({ id: z.string(), nickname: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { "openai/profile": true, securitySchemes: [{ type: "oauth2", scopes: ["workspace.read"] }] },
    },
    async () => {
      const profile = { id: client.user_id, nickname: client.client_name };
      return { structuredContent: profile, content: [{ type: "text", text: JSON.stringify(profile) }] };
    },
  );

  server.registerTool(
    "mcpos_get_audit_history",
    {
      title: "Read McpOS audit history",
      description: "Read recent audit events for the authenticated McpOS workspace. Returns only this workspace's events, newest first, with a bounded page size.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional(), before: z.string().datetime().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["workspace.read"] }] },
    },
    async ({ limit, before }) => {
      if (!client.scopes.includes("workspace.read")) return { content: [{ type: "text", text: "This MCP client does not have workspace.read permission." }], isError: true };
      const pageSize = Math.min(100, Math.max(1, limit ?? 30));
      const beforeFilter = before ? `&created_at=lt.${encodeURIComponent(before)}` : "";
      const response = await supabaseRest(`mcpos_device_audit?select=id,event_type,outcome,metadata,created_at&user_id=eq.${client.user_id}${beforeFilter}&order=created_at.desc&limit=${pageSize}`);
      if (!response.ok) return { content: [{ type: "text", text: "Could not retrieve McpOS audit history." }], isError: true };
      const events = await response.json();
      return { content: [{ type: "text", text: JSON.stringify({ events, nextBefore: events.length ? events[events.length - 1].created_at : null }, null, 2) }] };
    },
  );

  const coordinate = z.number().int().min(-32768).max(32767);
  const selector = z.string().trim().min(1).max(256);
  const printable = z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/);
  const runtimeId = z.array(z.number().int()).min(1).max(32);
  const stepSchema = z.discriminatedUnion("command", [
    z.object({ command: z.literal("input.pointer.click"), x: coordinate, y: coordinate, button: z.enum(["left", "right"]).default("left") }),
    z.object({ command: z.literal("input.pointer.move"), x: coordinate, y: coordinate }),
    z.object({ command: z.literal("input.pointer.scroll"), steps: z.number().int().min(-12).max(12), axis: z.enum(["vertical", "horizontal"]).default("vertical") }),
    z.object({ command: z.literal("input.keyboard.type"), text: printable }),
    z.object({ command: z.literal("input.keyboard.shortcut"), keys: z.array(z.string().min(1).max(12)).min(2).max(4) }),
    z.object({ command: z.literal("browser.open"), url: z.string().max(2048).refine(permittedBrowserUrl), newWindow: z.boolean().optional() }),
    z.object({ command: z.literal("browser.click"), selector, expectedText: z.string().trim().min(1).max(200).optional(), windowId: z.string().max(80).optional() }),
    z.object({ command: z.literal("browser.type"), selector, text: printable, windowId: z.string().max(80).optional() }),
    z.object({ command: z.literal("browser.snapshot") }),
    z.object({ command: z.literal("screen.capture"), displayId: z.number().int().nonnegative().optional() }),
    z.object({ command: z.literal("desktop.accessibility"), windowId: runtimeId.optional() }),
    z.object({ command: z.literal("desktop.launch"), application: z.enum(["chrome","calculator","notepad"]) }),
    z.object({ command: z.literal("desktop.focus"), windowId: runtimeId }),
    z.object({ command: z.literal("native.invoke"), windowId: runtimeId, controlId: runtimeId }),
    z.object({ command: z.literal("native.set_text"), windowId: runtimeId, controlId: runtimeId, text: z.string().max(2048) }),
    z.object({ command: z.literal("native.shortcut"), windowId: runtimeId, keys: z.array(z.string().min(1).max(12)).min(2).max(4) }),
    z.object({ command: z.literal("clipboard.write"), text: z.string().max(4096) }),
  ]);
  const waitOption = z.number().int().min(0).max(20000).default(0);
  async function taskStatus(taskId: string, waitMs: number, includeResults: boolean) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const response = await supabaseRest(`mcpos_device_commands?select=id,task_step,command,status,claimed_at,completed_at,expires_at,error_message&task_id=eq.${taskId}&mcp_client_id=eq.${client.id}&user_id=eq.${client.user_id}&order=task_step`);
      if (!response.ok) return { isError: true, content: [{ type: "text" as const, text: "Task status unavailable." }] };
      const steps = await response.json() as Array<{id:string; command:string; status:string; expires_at:string}>;
      if (!steps.length) return {isError:true, content:[{type:"text" as const,text:"Task not found for this connection."}]};
      let blocked = false;
      for (const step of steps) {
        if (["queued","claimed"].includes(step.status) && Date.parse(step.expires_at) <= Date.now()) step.status = "expired";
        if (blocked && step.status === "queued") step.status = "blocked";
        if (["failed","denied","expired"].includes(step.status)) blocked = true;
      }
      const pending = steps.some((s: {status:string}) => ["queued","claimed"].includes(s.status));
      if (pending && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, Math.min(750, deadline - Date.now())));
        continue;
      }
      const content: Array<{type:"text"; text:string} | {type:"image"; data:string; mimeType:string}> = [
        { type: "text", text: JSON.stringify({ taskId, steps, ...(pending ? {nextStep:"Resume with mcpos_get_task_status using the same taskId and waitMs. Do not resubmit actions."} : {}) }) }
      ];
      let missingResult = false;
      if (includeResults && !pending) {
        const captures = steps.filter((s: {command:string;status:string}) => s.command === "screen.capture" && s.status === "completed");
        for (const step of steps) {
          if (step.status !== "completed" || (step.command === "screen.capture" && step !== captures.at(-1))) continue;
          const result = await readCommand(step.id);
          if ("isError" in result && result.isError) missingResult = true;
          content.push(...result.content);
        }
      }
      const failed = steps.some((s: {status:string}) => ["failed","denied","expired"].includes(s.status));
      return {content, ...(includeResults && (failed || missingResult) ? {isError:true} : {})};
    }
  }
  server.registerTool("mcpos_execute_task", {
    title: "Run an ordered Windows task",
    description: "Queue up to eight steps on one device. Each step retains its own permissions and local approvals. Enable screenshotAfterAction to capture after each successful input action. Set waitMs (up to 20000) and finalScreenshot to return completed step results and the last JPEG in this call. Use the same task ID when recovering after a timeout.",
    inputSchema: z.object({ taskId: z.string().uuid(), deviceId: z.string().uuid(), steps: z.array(stepSchema).min(1).max(8), screenshotAfterAction: z.boolean().default(false), finalScreenshot: z.boolean().default(false), waitMs: waitOption }),
  }, async ({ taskId, deviceId, steps, screenshotAfterAction, finalScreenshot, waitMs }) => {
    if (waitMs && !client.scopes.includes("workspace.read")) return scopeError("workspace.read");
    const planned = steps.flatMap((step): z.infer<typeof stepSchema>[] =>
      screenshotAfterAction && !["screen.capture","desktop.accessibility","browser.snapshot"].includes(step.command)
        ? [step, { command: "screen.capture" }] : [step]);
    if (finalScreenshot && planned.at(-1)?.command !== "screen.capture") planned.push({command:"screen.capture"});
    const rows = [];
    const entitlement = await checkCommandEntitlement(client.user_id);
    if (entitlement.status !== "allowed") return { isError: true, content: [{ type: "text", text: "Desktop command entitlement unavailable." }] };
    const device = await supabaseRest(`mcpos_devices?select=id&id=eq.${deviceId}&user_id=eq.${client.user_id}&relay_version=gte.3&status=eq.online&last_seen_at=gte.${new Date(Date.now()-90000).toISOString()}`);
    if (!device.ok || !(await device.json()).length) return { isError: true, content: [{ type: "text", text: "An online McpOS Desktop 0.2.3 or later is required." }] };
    const expires = new Date(Math.min(Date.now() + 300000, entitlement.billing.billing_verified_until ? Date.parse(entitlement.billing.billing_verified_until) : Infinity)).toISOString();
    for (const [index, { command, ...payload }] of planned.entries()) {
      if (["native.invoke","native.set_text"].includes(command) && !client.scopes.includes("screen.accessibility")) return scopeError("screen.accessibility");
      const scope = ["native.invoke","native.set_text","desktop.launch","desktop.focus","native.shortcut","clipboard.write"].includes(command) ? "input.keyboard" : command.startsWith("browser.") ? "browser.control" : command === "desktop.accessibility" ? "screen.accessibility" : command.split(".").slice(0,2).join(".");
      if (!client.scopes.includes(scope)) return scopeError(scope);
      const verify = command === "browser.click" && "expectedText" in payload && payload.expectedText;
      rows.push({ user_id: client.user_id, device_id: deviceId, mcp_client_id: client.id, ...entitlement.billing, command: verify ? "browser.open" : command, payload: verify ? { ...payload, windowAction: "browser.verified_click" } : payload, expires_at: expires, task_id: taskId, task_step: index });
    }
    const queued = await supabaseRest("mcpos_device_commands", { method: "POST", body: JSON.stringify(rows) });
    if (queued.status === 409) return {isError:true, content:[{type:"text",text:JSON.stringify({taskId,message:"Task ID conflict. Inspect the original task with mcpos_get_task_status before taking further action."})}]};
    if (!queued.ok) return queueError(queued);
    if (waitMs) return taskStatus(taskId, waitMs, true);
    return { content: [{ type: "text", text: JSON.stringify({ taskId, queuedSteps: rows.length, expires }) }] };
  });
  server.registerTool("mcpos_cancel_task", {
    title: "Stop queued task steps",
    description: "Expire this client's queued steps. A step already claimed by Windows may finish. Inspect task status before attempting recovery.",
    inputSchema: z.object({taskId: z.string().uuid()}),
  }, async ({taskId}) => {
    if (!client.scopes.includes("workspace.read")) return scopeError("workspace.read");
    const response = await supabaseRest(`mcpos_device_commands?task_id=eq.${taskId}&user_id=eq.${client.user_id}&mcp_client_id=eq.${client.id}&status=eq.queued&select=id`, {
      method: "PATCH", headers: {Prefer:"return=representation"},
      body: JSON.stringify({status:"expired", error_message:"Cancelled by requesting client", completed_at:new Date().toISOString()}),
    });
    if (!response.ok) return {isError:true, content:[{type:"text",text:"Task cancellation failed. Inspect the task before retrying."}]};
    const cancelled = await response.json();
    return {content:[{type:"text",text:JSON.stringify({taskId,cancelledSteps:cancelled.length})}]};
  });
  server.registerTool("mcpos_get_task_status", {
    title: "Read task progress and history",
    description: "Returns ordered command IDs, timestamps and outcomes. Set waitMs to resume waiting and collect one-time results plus the last screenshot. With waitMs zero this only reads progress.",
    inputSchema: z.object({ taskId: z.string().uuid(), waitMs: waitOption }),
  }, async ({ taskId, waitMs }) => {
    if (!client.scopes.includes("workspace.read")) return scopeError("workspace.read");
    return taskStatus(taskId, waitMs, waitMs > 0);
  });
  return server;
}

async function handle(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowedOrigins = new Set(["https://chatgpt.com", "https://chat.openai.com", "https://claude.ai"]);
  if (origin && !allowedOrigins.has(origin)) {
    return NextResponse.json({ error: "Origin not allowed." }, { status: 403 });
  }
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
      { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="' + MCP_ISSUER + '/.well-known/oauth-protected-resource", error="invalid_token"' } },
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
