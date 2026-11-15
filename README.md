# McpOS

McpOS is a Codex-style development workspace for repositories, AI coding tasks, reviews, isolated execution, and deployments. It is designed to expose approved workspace capabilities through a remote MCP endpoint so compatible clients, including Claude and supported ChatGPT plans, can connect.

## Current status

The initial application foundation is committed to `main`:

- Responsive dark workspace dashboard.
- GitHub App OAuth connection with encrypted, HTTP-only server-side session cookie.
- Read-only repository discovery across GitHub App installations and an interactive repository picker (selection is session-only).
- Next.js App Router and TypeScript foundation.
- Authenticated, stateless Streamable HTTP MCP endpoint at `/api/mcp`.
- Read-only MCP tools: `mcpos_status` and `mcpos_capabilities`.
- CI workflow for type checking, linting, and production build.
- Architecture and security boundary documentation.

This is not yet a production coding agent: arbitrary code execution, repository write access, OAuth, durable task storage, sandboxing, and deployment controls are not enabled.

## Local development

Requirements: Node.js 20.9+ and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000.

## Environment

Set `MCP_BEARER_TOKEN` to a randomly generated secret of at least 32 characters. Never commit real secrets. For GitHub repository discovery, configure the GitHub App OAuth variables described in [docs/GITHUB_APP_SETUP.md](docs/GITHUB_APP_SETUP.md). Keep all credentials server-side.

## Connect an MCP client

After deploying the application to an HTTPS host and configuring `MCP_BEARER_TOKEN`, configure a compatible MCP client to use:

- URL: `https://YOUR_HOST/api/mcp`
- Transport: Streamable HTTP
- Authentication: HTTP Bearer token

The initial endpoint exposes only non-mutating discovery tools. The token is a bootstrap credential; before multi-user use, replace it with per-client credentials, revocation, rate limiting, and persistent audit logs.

## Planned milestones

1. GitHub App integration with repository-scoped permissions. (OAuth connection and read-only repository discovery are implemented; persistent project records remain planned.)
2. Durable agent tasks, streamed events, cancellation, approvals, and task history.
3. Disposable execution sandboxes with CPU, memory, time, filesystem, and network controls.
4. Browser preview, screenshots, console/network diagnostics, and regression checks.
5. Vercel and Supabase adapters with approval gates for production changes.
6. Multi-agent orchestration, checkpoints, review, and rollback workflows.

## Security principles

- Never execute user-provided commands in the Next.js web process.
- Never expose private keys, service-role keys, model keys, or MCP tokens to browser code.
- Require explicit approval for production deployments, destructive SQL, permission changes, and irreversible Git operations.
- Use short-lived, repository-scoped credentials inside isolated execution environments.
- Record actor, project, action, approval, and outcome without logging secret values.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the target design and security boundaries.
