# McpOS Desktop companion

This is the Windows-first Tauri 2 starter application.

## Requirements

- Windows 10/11
- Node.js 20.9+ and npm
- Rust stable toolchain
- Microsoft C++ Build Tools and WebView2 Runtime (Tauri prerequisites)

## Run locally

```powershell
cd desktop
npm install
npm run tauri:dev
```

Generate the Windows icon before checking/building the native host (the CI workflow does this automatically):\n\n\`\`\`powershell\npython scripts/generate_icon.py\n\`\`\`\n\nBuild the frontend:

```powershell
npm run build
```

## Current safety boundary

This starter is a local shell only. It does not capture the screen, simulate input, inspect files, launch applications, establish a network connection or expose an MCP server. Those capabilities must be implemented as narrow, separately permissioned native commands with visible consent and audit events.
