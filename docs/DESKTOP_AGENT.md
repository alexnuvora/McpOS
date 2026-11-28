# McpOS desktop-agent architecture

## Components

1. **Desktop companion** — a Tauri 2 + Rust Windows application. It owns screen, accessibility, input, approved-folder and isolated-browser operations.
2. **Gateway** — the Next.js MCP endpoint and Supabase Edge Functions. It authenticates AI clients and devices, queues typed commands and records outcomes.
3. **Control Centre** — the Next.js dashboard for pairing, per-client scopes, device/session revocation and audit history.

The desktop companion polls the Supabase queue over outbound HTTPS every 10 seconds. No inbound PC port is exposed. This is a polling relay, not a persistent low-latency stream.

## Authentication and revocation

- Claude/compatible bearer clients have individually generated tokens. ChatGPT Enterprise uses OAuth 2.1 authorization-code + PKCE with DCR, protected-resource discovery, explicit user consent, resource-bound short-lived access tokens and rotating refresh tokens. Only SHA-256 token hashes are stored.
- Every queued command records the requesting AI client ID.
- Revoking a client cancels its queued and claimed commands. The Windows companion rechecks device credentials and the requesting client session immediately before executing a locally approved action.
- Device credentials are stored in the Windows credential store.
- Audit rows record requests, command outcomes, denials, failures and revocations. The audit table is an application log, not a tamper-proof compliance ledger.

## Implemented capabilities

| Capability | Boundary |
|---|---|
| `desktop.status` | Read-only device status |
| `screen.capture` | One primary-display JPEG snapshot; visible local switch defaults OFF and resets OFF on restart; optional MCP scope |
| `screen.accessibility` | Read-only list of up to 40 top-level Windows windows (name, class, role and process ID); local switch defaults OFF |
| `files.read` | Native folder picker; canonical-path containment; 100-entry listing cap; 512 KB UTF-8 text reads; extension allowlist; no writes/deletes |
| `input.pointer` | One left/right click within primary display bounds; exact action shown in local approval prompt |
| `input.keyboard` | Text entry limited to 200 printable characters; exact text shown in local approval prompt |
| `browser.control` | Dedicated WebView2 data directory; public HTTPS navigation; bounded permitted popups on supported companions; downloads blocked; bounded text snapshot; selector click/text entry each require local approval |

All optional scopes are unchecked when creating an AI client key. Local screen, accessibility and browser switches default OFF and reset to OFF on restart. Folder grants reset to an empty list on restart. Pointer/keyboard and browser navigation/click/type requests require a fresh one-time local approval.

## Browser isolation

The isolated browser is a separate WebView2 window with its own data directory, not the user's normal Edge/Chrome profile. It rejects non-HTTPS navigation, embedded credentials, localhost, `.local` and literal private/loopback IP addresses. On companions supporting multiple windows, permitted HTTPS popups and an inert about:blank bootstrap are accepted within a maximum of six isolated windows; each child uses the opener's WebView2 environment and the same navigation/download restrictions. Downloads remain blocked. Explicit newWindow navigation can open another window. Version 0.2.2 assigns unique window IDs. List windows, select one, or explicitly target snapshots and actions by ID. Turning off local browser consent closes all windows. This is not network-level isolation; DNS and subresource egress remain a launch blocker. Version 0.2.2 uses Tauri's native script-result callback rather than a loopback network bridge. Results are bounded and the script checks that navigation has not changed before running. Some sites or embedded frames may still be incompatible.

## File-access boundary

Only folders explicitly selected in the Windows companion are readable. Every requested path is canonicalised and checked to remain beneath one of those roots; symlink entries are skipped. Only a small allowlist of UTF-8 text extensions is readable, and each file is capped at 512 KB. There is no remote write, delete, execute or upload command.

## Not implemented

- Arbitrary shell, PowerShell or generic command execution.
- Application launch, clipboard access, continuous screen recording or full accessibility-tree traversal.
- File writes, deletes or uploads.
- CIMD and private_key_jwt OAuth client authentication; ChatGPT currently uses DCR with a public PKCE client.
- Persistent WebSocket relay.
- Tamper-proof external audit retention.

## Deployment and validation

The feature branch is a draft PR. It is not production until the Windows build, web CI, Supabase migration/Edge Function deployment and Netlify deployment all pass. Real-device testing is still required for screenshot rendering, UI Automation, input approval, browser bridge compatibility, folder path restrictions and revocation races.