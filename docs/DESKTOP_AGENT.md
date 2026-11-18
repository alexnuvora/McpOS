# McpOS architecture

## Product shape

McpOS is a Windows-first desktop agent platform with three cooperating components:

1. **Desktop companion** — a locally installed Tauri 2 + Rust application. It owns all access to the user's screen, input devices, files, browser and desktop applications.
2. **Gateway** — the web-hosted identity, MCP and relay service. It authenticates AI clients and paired devices, authorises individual tool calls, routes requests to the correct online device and records audit events.
3. **Control Centre** — the Next.js web application for account management, device pairing, permissions, active sessions, audit history and integrations.

The desktop companion makes outbound authenticated HTTPS polling requests to the Supabase command queue and posts results back. No public inbound port or direct internet exposure of the user's PC is required. A persistent WebSocket relay is not yet implemented.

## Request flow

1. The user installs the signed desktop companion and signs in or pairs it using a short-lived one-time code.
2. The companion creates a device identity and polls the authenticated command queue over outbound HTTPS.
3. An AI client authenticates separately to the MCP gateway using an individually revocable, hashed client credential.
4. The gateway verifies the user, client, device, capability grant and session state for every tool call, then queues a typed command.
5. The companion claims the queued command using its device credential, validates the typed command locally, and returns a structured result. Only the read-only desktop.status command is implemented today.
6. The gateway returns the result to the MCP client. Screen observation and computer-control commands remain disabled pending local consent and approval flows.

The gateway is a broker, not a remote desktop host. Screen pixels and local files should not be retained by default.

## Desktop capability boundaries

Capabilities are independent grants and default to disabled:

- `desktop.status` — device and session status.
- `screen.capture` — capture the screen during a visible, user-started session.
- `screen.accessibility` — inspect accessible UI element names, roles and bounds.
- `input.pointer` — bounded pointer movement and clicks.
- `input.keyboard` — text entry and key presses, with sensitive-field safeguards.
- `browser.*` — operate a dedicated, user-approved browser profile.
- `files.read` / `files.write` — access only user-selected folders.
- `apps.launch` — launch explicitly allowed applications.

No generic `shell.exec`, arbitrary PowerShell, credential-store access, hidden persistence, or unrestricted filesystem tool is part of the initial design.

## Approval model

Always require a fresh, visible user confirmation for consequential actions, including sending or publishing content, purchases, submitting external forms, deleting or overwriting files, installing software, changing security settings, privilege elevation and actions that cannot be readily undone.

The user can pause a session, revoke a capability, disconnect a device or revoke all device credentials from the Control Centre. A visible tray indicator shows when screen observation or control is active.

## Windows implementation

- Tauri 2 provides the desktop shell and Rust process boundary.
- Rust owns privileged operations and exposes a small typed command surface to the UI.
- Windows UI Automation is the preferred route for semantic controls and accessibility information.
- Windows Graphics Capture is the preferred route for user-consented screen frames.
- Input simulation is limited to the active, consented desktop session.
- Browser automation runs through a dedicated adapter and isolated browser profile, not the user's personal browser profile by default.
- Local secrets are stored with Windows DPAPI/Credential Manager; never in plaintext config files.

The native API choices must be validated with a Windows prototype before broad capability rollout. The repository's CI environment is not a substitute for testing on a real Windows desktop.

## Gateway and MCP

The `/api/mcp` endpoint uses individually revocable MCP client credentials and exposes device listing plus a read-only `desktop.status` request over a Supabase-backed outbound polling queue. Persistent streaming relay, OAuth discovery, screen capture and input control remain outstanding.

Before screen or input control is exposed, complete:
- OAuth 2.1 / MCP protected-resource metadata for clients that require OAuth.
- Per-device and per-tool authorisation, including local consent state.
- A visible local approval surface and immediate pause control.
- Request correlation, expiry, replay protection and rate limiting for every command type.
- Append-only audit records with secret and sensitive-content redaction.

MCP tools should have narrow schemas and explicit descriptions of side effects. The gateway must never forward an unvalidated arbitrary command string to the desktop.

## Existing integrations

The GitHub App OAuth and read-only repository picker remain optional integrations in the Control Centre. They are separate from local desktop access. Repository write operations, agent execution, production deployments and database mutations remain disabled until their own approval and isolation designs are implemented.

## Security requirements

- Default-deny permissions and least privilege.
- User-visible session indicator and immediate pause control.
- No public inbound listener on the user's computer.
- Mutual authentication between companion and gateway.
- TLS in transit and OS-backed local secret storage.
- Explicit consent for screen capture and approvals for consequential actions.
- Folder allow-lists and browser profile isolation.
- Signed installers and update packages.
- No raw shell, unrestricted filesystem, credential extraction or stealth operation.
- Auditable actions with sensitive data minimised and redacted.
- Threat modelling and independent security review before general availability.
