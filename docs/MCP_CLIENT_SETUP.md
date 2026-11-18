# Connecting AI clients to McpOS

## Endpoint

The authenticated remote MCP endpoint is:

`https://mcpos-dashboard.netlify.app/api/mcp`

The gateway uses per-client bearer credentials. Do not use the old shared `MCP_BEARER_TOKEN` for the new client flow.

## Create a client credential

1. Sign in to the McpOS dashboard.
2. Open **AI connections** from the left navigation, or visit `/integrations`.
3. Create one credential per AI client (for example, Claude Desktop).
4. Select only the additional scopes that client needs. Every extra scope is unchecked by default.
5. Copy the token immediately. It is only displayed once; the database stores only its SHA-256 hash.
6. If a token is lost, revoke that client and create a replacement.

Base scopes: `workspace.read`, `desktop.status`.

Optional scopes:
- `screen.capture` — one-shot screenshot; the Windows local screen-capture switch must be ON.
- `screen.accessibility` — bounded read-only top-level Windows application discovery; the local application-understanding switch must be ON.
- `files.read` — list/read UTF-8 text files only inside folders selected with the native folder picker on Windows. No writes or deletes.
- `input.pointer` — request one left/right pointer click; exact coordinates require local approval every time.
- `input.keyboard` — request text entry up to 200 printable characters; the exact text requires local approval every time.
- `browser.control` — isolated browser navigation, page snapshot, selector click and text entry. The local browser switch must be ON; open/click/type each require local approval.

The Windows local switches reset to OFF when the companion restarts. Folder approvals also reset to an empty list on restart. The isolated browser uses a separate WebView2 profile; it permits public HTTPS URLs only, denies pop-up windows and downloads, and blocks literal private/loopback IP addresses. File tools are read-only and restricted to a small text-file allowlist. Sensitive command results (screenshots, page snapshots and file text) are cleared from the command row after their first successful MCP retrieval; revoking a client also clears its completed results.

## Claude Desktop

For a Claude Desktop installation that supports remote custom connectors, use the server URL and bearer token in its connector settings.

For clients that require a local stdio bridge, install Node.js and use the `mcp-remote` bridge. Add this server to Claude Desktop's MCP configuration, replacing the placeholder with the token you copied:

```json
{
  "mcpServers": {
    "mcpos": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcpos-dashboard.netlify.app/api/mcp",
        "--header",
        "Authorization: Bearer YOUR_MCPOS_CLIENT_TOKEN"
      ]
    }
  }
}
```

Restart Claude Desktop after saving the configuration. Never commit this file or token to GitHub or share it in a conversation.

## Available tools

- `mcpos_status`, `mcpos_capabilities`, `mcpos_list_devices` — identity, capabilities and paired devices.
- `mcpos_request_desktop_status` — queue a read-only status request.
- `mcpos_capture_screen` — request one JPEG screenshot, with client scope and local consent.
- `mcpos_get_accessibility_snapshot` — inspect a bounded list of top-level application windows.
- `mcpos_access_approved_files` — list approved folders, list a selected folder or read a small text file.
- `mcpos_request_input_action` — request a bounded pointer click or text entry; never executes without local one-time approval.
- `mcpos_browser_automation` — open, snapshot, click or type in the isolated browser; local approval is required for navigation and page actions.
- `mcpos_get_command_status` — retrieve queued command results.

The Windows companion polls the authenticated Supabase command queue over outbound HTTPS every 10 seconds. No inbound port or router configuration is needed. This is a polling relay, not a low-latency streaming session. Arbitrary shell commands, app launch, file writes/deletes, clipboard access and continuous screen recording are not exposed.

## ChatGPT Enterprise

McpOS supports the ChatGPT Enterprise custom MCP connector flow using OAuth 2.1 authorization code + PKCE, dynamic client registration, one-hour access tokens, rotating 30-day refresh tokens, explicit McpOS user consent and session revocation. ChatGPT does not need a manually copied bearer key.

**MCP endpoint:** `https://mcpos-dashboard.netlify.app/api/mcp`

**OAuth discovery:**
- Protected resource: `https://mcpos-dashboard.netlify.app/.well-known/oauth-protected-resource`
- Authorization server: `https://mcpos-dashboard.netlify.app/.well-known/oauth-authorization-server`

To connect:
1. Use ChatGPT on the web. An Enterprise workspace admin must allow **Create plugins with MCPs** / custom MCP connector creation under Workspace Settings → Permissions & Roles → Connected Data. If you are not an admin, ask the admin to grant your account the relevant developer permission.
2. Open Settings → Apps → Advanced Settings and enable Developer mode if your workspace uses that flow. Alternatively, admins/owners can create the connector from Workspace Settings → Apps → Create. In the current Plugins experience, open Plugins → + → Add custom MCP server.
3. Add the endpoint above, name it **McpOS Desktop**, and select **OAuth** authentication. Do not choose a static API key or paste a Claude bearer token.
4. Scan the tools and create the app. When ChatGPT starts the OAuth flow, sign in to the McpOS dashboard using an authorised McpOS email address.
5. Review the requested permissions on the McpOS consent screen and approve only the scopes you want to grant.
6. Return to ChatGPT, install/enable the draft app and test it in a new web chat by selecting the app (or using `@` to mention it).

The OAuth flow uses DCR with public-client PKCE (S256); no client secret is issued. Access tokens are audience-bound to the McpOS MCP endpoint, stored only as SHA-256 hashes, expire after one hour and refresh tokens rotate. Revoking the ChatGPT session from McpOS → AI connections invalidates the access and refresh session.

Recommended first tests:
- `mcpos_profile` — confirms which McpOS workspace is connected.
- `mcpos_status` and `mcpos_capabilities` — confirms the MCP endpoint and feature list.
- `mcpos_list_devices` — checks the paired Windows companion.
- `mcpos_request_desktop_status` then `mcpos_get_command_status` — tests the outbound desktop relay.
- `mcpos_get_audit_history` — confirms audit visibility.

Screen, accessibility, folder, browser and input tools also require their separate AI-client scopes and local Windows consent. Mouse, keyboard and browser actions still require an explicit one-time approval on the PC. ChatGPT's tool annotations identify read-only versus state-changing operations; the Windows local approval remains the final execution gate.

After changing MCP tool names, descriptions, schemas or annotations, refresh the app's tool list in Workspace Settings → Apps. ChatGPT keeps a frozen snapshot of the approved tool definitions until an admin refreshes it.
## Revocation and audit

From **AI connections**, revoke one client or use **Revoke all sessions** to invalidate every active AI client key. You can also revoke a Windows device from the Devices section of the main dashboard. The **Audit history** page paginates recorded pairing, request, command-outcome and revocation events.
