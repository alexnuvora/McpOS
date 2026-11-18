# McpOS

McpOS is a Windows-first AI desktop agent platform. It gives authorised AI clients controlled access to a user's real desktop, applications, browser and approved local files through MCP.

The product has three parts:

- **McpOS Desktop** — a local Windows companion that observes and operates the desktop through permission-scoped native capabilities.
- **McpOS Gateway** — an authenticated MCP gateway and secure outbound relay between AI clients and paired desktop companions.
- **McpOS Control Centre** — the web dashboard for pairing devices, managing permissions, reviewing activity and configuring integrations.

## Product direction

The primary use case is computer use: an AI can inspect the user's screen, understand the current application state, click, type, navigate, and complete workflows across desktop and browser applications. The user remains in control through visible sessions, granular permissions and approval gates.

The desktop companion will initiate outbound encrypted connections. A user's PC will not need a public inbound port. Local execution remains on the user's computer; the gateway routes authorised requests and must not become a remote shell.

## Current implementation status

The repository currently contains:

- Responsive Next.js control centre with GitHub OAuth identity verification.
- GitHub identity mapped server-side to a private Supabase Auth user; GitHub tokens remain in an encrypted, HTTP-only cookie.
- One-use, five-minute desktop pairing codes created by the dashboard.
- Supabase Edge Functions for atomic pairing completion and device-token heartbeat authentication.
- Hashed device credentials, owner-scoped revocation, and audit events; capabilities remain disabled by default.
- Windows Tauri companion with device pairing and credential storage through Windows Credential Manager.
- Persistent 30-second heartbeat and live connected/disconnected tray indicator.
- Authenticated, stateless Streamable HTTP MCP endpoint at `/api/mcp`, with separate hashed/revocable AI-client credentials.
- Dashboard AI Connections page for creating and revoking client credentials.
- Supabase-backed outbound command queue, with device-authenticated polling and result submission.
- First end-to-end read-only desktop relay command: `desktop.status`.
- MCP tools for client status, capability discovery, paired-device listing, desktop-status requests and command-result retrieval.
- GitHub Actions for Supabase migrations/function deployment, endpoint smoke tests, Next.js validation and Windows installer builds.

**Still not implemented:** screen capture, Windows accessibility, mouse/keyboard control, browser automation, app launching, approved-folder file access, interactive approval prompts and MCP OAuth. These remain disabled; the relay deliberately accepts only the typed `desktop.status` command.

## Proposed technical direction

- Windows-first desktop companion using **Tauri 2 + Rust** for the native shell and privileged OS boundary.
- Native Windows UI Automation for accessible application controls; Windows Graphics Capture for screen capture; carefully scoped input simulation for mouse and keyboard.
- Browser automation through a separately permissioned local browser adapter.
- A device-initiated, mutually authenticated outbound connection to the gateway for remote MCP clients.
- A local MCP adapter for compatible desktop MCP clients where supported.
- Per-device identity, short-lived credentials, per-tool grants, explicit approvals and append-only audit events.

The native agent must expose narrow, typed actions rather than a generic unrestricted shell. Screen capture, input, files, browser and application access are separately permissioned capabilities.

## Security principles

- Default to deny. Pairing a device does not grant every capability.
- Show a persistent, visible indicator while screen observation or computer control is active.
- Require explicit approval for sending messages, submitting forms, purchases, deleting or overwriting files, installing software, privilege changes and other consequential actions.
- Restrict file access to user-approved folders; block credential stores, browser profiles and OS security locations by default.
- Never expose raw desktop credentials, MCP tokens or integration secrets to the browser.
- Do not accept arbitrary shell commands from remote AI clients. If a terminal capability is added later, it must be a separate opt-in sandbox with command policy, limits and approval.
- Authenticate devices individually; support immediate revocation and session termination.
- Encrypt traffic in transit and protect local credentials with the operating system's secure credential storage.
- Log tool, device, actor, approval and outcome while redacting secrets and sensitive screen content.

## Local development

Requirements: Node.js 20.9+ and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000.


## Dashboard authentication

The control centre uses Supabase Auth email magic links. No GitHub App or GitHub OAuth credentials are required. GitHub Actions remains responsible for deployment automation and is independent of dashboard sign-in.

Configure these Netlify environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`: the McpOS Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key. This is designed for browser use.
- `SUPABASE_URL`: the same project URL, for server-side device operations.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service-role/secret key. Never prefix this with `NEXT_PUBLIC_`.
- `MCPOS_ALLOWED_EMAILS`: comma-separated allowlist of email addresses permitted to use this private workspace.

In Supabase Authentication > URL Configuration, set the Site URL to `https://mcpos-dashboard.netlify.app` and add these Redirect URLs:

- `https://mcpos-dashboard.netlify.app/auth/callback`
- `http://localhost:3000/auth/callback` (local development)

Ensure the Email provider is enabled. The callback verifies the signed-in user's email against `MCPOS_ALLOWED_EMAILS`; unapproved users are signed out and cannot access device APIs. Device ownership continues to use the authenticated Supabase user ID. The service-role key is used only by server-side API routes.

## Remote MCP clients

The endpoint is `https://mcpos-dashboard.netlify.app/api/mcp`. Create a separate client credential from the dashboard's **AI connections** page; credentials are hashed in storage and can be revoked independently. The first remote relay supports paired-device listing and a read-only `desktop.status` request. See [docs/MCP_CLIENT_SETUP.md](docs/MCP_CLIENT_SETUP.md) for Claude setup and ChatGPT plan limitations.

## Delivery milestones

1. **Product foundation:** Windows-first architecture, capability model, threat model and updated control-centre experience.
2. **Desktop companion shell:** Tauri 2 app, secure local pairing, device identity, tray/status indicator and revocation.
3. **Safe observation:** screen capture and Windows accessibility tree with explicit session consent.
4. **Computer use:** bounded mouse/keyboard actions, visible action preview and per-action approval options.
5. **MCP relay:** device-initiated secure connection, per-device routing and remote MCP tool exposure.
6. **Browser and files:** isolated browser profile and allow-listed folder access.
7. **Hardening:** signed installer, updates, security review, audit trail, rate limits and recovery controls.
8. **macOS support:** after the Windows experience is stable.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DESKTOP_AGENT.md](docs/DESKTOP_AGENT.md).
