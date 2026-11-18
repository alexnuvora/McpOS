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

The Windows local switches reset to OFF when the companion restarts. Folder approvals also reset to an empty list on restart. The isolated browser uses a separate WebView2 profile; it permits public HTTPS URLs only, denies pop-up windows and blocks literal private/loopback IP addresses. File tools are read-only and restricted to a small text-file allowlist.

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

## ChatGPT

ChatGPT custom MCP apps are plan- and workspace-dependent. OpenAI currently documents custom MCP connections on the web for Business and Enterprise/Edu, with Pro support limited to read/fetch use cases. Free accounts do not currently have the documented custom MCP connector capability. See the current [OpenAI connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

When the account and workspace support custom MCP apps, create a custom MCP server connection using the endpoint above and configure bearer/API-key authentication with the client token. ChatGPT's UI and authentication options may vary by workspace. Do not publish write-capable tools without explicit local approval.

## Revocation and audit

From **AI connections**, revoke one client or use **Revoke all sessions** to invalidate every active AI client key. You can also revoke a Windows device from the Devices section of the main dashboard. The **Audit history** page paginates recorded pairing, request, command-outcome and revocation events.
