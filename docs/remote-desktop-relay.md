# McpOS remote desktop relay

## Architecture

- The Windows companion opens an outbound TLS WebSocket to `/relay/device`.
- The relay validates the device credential by calling the Supabase `device-heartbeat` Edge Function. The raw device token is never stored by the relay.
- The MCP API sends commands to the relay over the private Docker network at `http://relay:8080/internal/command`.
- The internal command endpoint requires `MCPOS_RELAY_SECRET`; it is not published by Docker or Caddy.
- The desktop companion checks the locally stored capability permission and then displays a one-request approval dialog. Denial or a 30-second timeout blocks the action.
- The relay accepts only the five explicitly implemented desktop command names. It has bounded request sizes and a command timeout.

## Required runtime configuration

The Oracle host's `.env` needs:

- `SUPABASE_URL`
- `MCPOS_RELAY_SECRET` — generate a unique value with `openssl rand -hex 32`; use the same value for the web app and relay container
- `MCPOS_PUBLIC_IP` — the public IP assigned to the dedicated McpOS host
- The normal web app settings documented in `.env.example`, including `MCP_BEARER_TOKEN` and the configured GitHub OAuth/Supabase values

Set the Supabase Edge Function secret `MCPOS_RELAY_URL` to:

```text
wss://<MCPOS_PUBLIC_IP>/relay/device
```

The pairing-complete function returns that URL to newly paired desktop clients. Re-pair a device after changing the relay URL so it stores the new endpoint.

## TLS on an IP address

McpOS uses a publicly trusted short-lived Let's Encrypt IP certificate. Certbot 5.4 or newer is required and the `shortlived` profile must be selected. Certificates are valid for 160 hours, so automatic renewal and a Caddy reload hook are mandatory. Keep host port 80 reachable for HTTP-01 validation and port 443 reachable for desktop WebSockets and the web control centre.

The Caddy container reads:

- `/etc/letsencrypt/live/<IP>/fullchain.pem`
- `/etc/letsencrypt/live/<IP>/privkey.pem`

The Docker Compose file deliberately does not publish the relay's port 8080. Only Caddy exposes the TLS endpoint.

## Local verification

From the repository root:

```sh
npm install --prefix relay
npm test --prefix relay
```

The integration test uses a local mock Supabase heartbeat endpoint and verifies device authentication, rejection of unauthorised internal requests, offline-device handling, WebSocket command delivery and result correlation.

## Safety properties

- Screen capture, accessibility, mouse and keyboard permissions are stored in Windows Credential Manager and default to off.
- Every remote action requires a fresh local approval. Approval is not remembered for later actions.
- Revoking a capability blocks subsequent requests even if the relay remains connected.
- Device revocation is enforced by the heartbeat endpoint when the relay authenticates the connection.
- The relay does not expose a general shell, arbitrary process launch, file-system access or unrestricted command execution.
