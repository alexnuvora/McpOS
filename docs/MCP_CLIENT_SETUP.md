# Connecting AI clients to McpOS

## Endpoint

The authenticated remote MCP endpoint is:

`https://mcpos-dashboard.netlify.app/api/mcp`

The gateway uses per-client bearer credentials. Do not use the old shared `MCP_BEARER_TOKEN` for the new client flow.

## Create a client credential

1. Sign in to the McpOS dashboard.
2. Open **AI connections** from the left navigation, or visit `/integrations`.
3. Create one credential per AI client (for example, Claude Desktop).
4. Copy the token immediately. It is only displayed once; the database stores only its SHA-256 hash.
5. If a token is lost, revoke that client and create a replacement.

New credentials have only these scopes:
- `workspace.read`
- `desktop.status`

They do not grant screen capture, keyboard, mouse, browser, app launch or file access.

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

## Available tools in this release

- `mcpos_status` — verify the AI client is authenticated.
- `mcpos_capabilities` — inspect implemented and planned capabilities.
- `mcpos_list_devices` — list the owner's paired devices.
- `mcpos_request_desktop_status` — queue a read-only status request to an online Windows companion.
- `mcpos_get_command_status` — retrieve the result of that request.

The desktop companion polls the authenticated Supabase command queue over outbound HTTPS every 10 seconds. No inbound port or router configuration is needed. This first release favours a low-cost polling baseline; it is not yet a low-latency streaming session. Only the typed `desktop.status` command is implemented in this first relay increment; arbitrary commands are not accepted.

## ChatGPT

ChatGPT custom MCP apps are plan- and workspace-dependent. OpenAI currently documents custom MCP connections on the web for Business and Enterprise/Edu, with Pro support limited to read/fetch use cases. Free accounts do not currently have the documented custom MCP connector capability. See the current [OpenAI connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

When the account and workspace support custom MCP apps, create a custom MCP server connection using the endpoint above and configure bearer/API-key authentication with the client token. ChatGPT's UI and authentication options may vary by workspace. Do not publish write-capable tools until the permission and approval stages have been completed.

## Revocation

From **AI connections**, revoke a client to invalidate its token immediately. You can also revoke the Windows device from the Devices section of the main dashboard.
