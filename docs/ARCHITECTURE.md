# McpOS architecture

## Initial foundation

- Next.js App Router provides the web workspace and HTTP endpoint.
- The MCP endpoint uses the official TypeScript MCP SDK and Streamable HTTP transport.
- A server-side bearer token protects the initial endpoint.
- The initial tool surface is read-only and exposes status/capability discovery only.

## GitHub integration (first read-only slice)

- The user connects through the GitHub App OAuth authorization flow.
- OAuth state is generated server-side and checked in the callback.
- The GitHub access token is encrypted with AES-256-GCM and stored only in an HTTP-only, SameSite=Lax cookie. The encryption key is derived from `GITHUB_SESSION_SECRET`.
- Repository discovery uses the user's GitHub App access token to enumerate installations and their accessible repositories.
- The browser receives repository metadata only; it never receives the access token.
- The picker selection is currently in client state only. It is not a durable project record.
- The App should be installed with Metadata: read-only and Contents / Pull requests: read-only. No write operations are implemented.

See [GITHUB_APP_SETUP.md](GITHUB_APP_SETUP.md) for setup instructions.

## Target architecture

1. **Web application** — projects, task board, editor/terminal panes, logs, approvals and settings.
2. **Identity and authorization** — user sessions, project membership, role-based permissions and scoped integration grants.
3. **Agent orchestration** — durable task records, task event stream, cancellation, retry policy, checkpoints and agent delegation.
4. **Execution provider** — disposable containers/VMs with CPU, memory, time, filesystem and network limits.
5. **Git provider** — GitHub App installation tokens scoped to selected repositories.
6. **MCP gateway** — per-client credentials, per-tool authorization, rate limits and audit events.
7. **Integrations** — Vercel and Supabase adapters with approval gates for production changes.

## Security boundaries

- Never run user-provided shell commands inside the Next.js web process.
- Never expose GitHub private keys, Supabase service-role keys, model keys or MCP tokens to client components.
- Do not make production deployments or destructive database changes without a separate approval step.
- Use short-lived, repository-scoped credentials inside execution environments.
- Record tool invocations and outcomes without logging secret values.
- Enforce request size limits, rate limits and per-user/project authorization before enabling write tools.

## MCP endpoint

The initial endpoint is `/api/mcp`. It requires an Authorization bearer token whose value is configured in `MCP_BEARER_TOKEN`. Use a randomly generated secret of at least 32 characters. The endpoint is stateless and currently exposes only non-mutating discovery tools.

Before enabling external users, replace the single shared token with per-client credentials and persistent revocation, rate limiting, and audit logging.
