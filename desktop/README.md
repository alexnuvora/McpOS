# McpOS Desktop companion

McpOS is a Windows-first Tauri 2 desktop relay for connecting an authenticated AI workspace to a paired device. The desktop companion uses an outbound connection and local permission controls; it does not require an inbound public port.

## Supported systems and local development

- Windows 10/11 with WebView2
- Node.js 22 and npm
- Rust stable toolchain and Microsoft C++ Build Tools
- Python for generating the application icon

```powershell
cd desktop
npm install
python scripts/generate_icon.py
npm run tauri:dev
```

Run `npm run build` to type-check and build the frontend; run `npm run tauri:build` to build local installers.

## Safety and distribution

Pair the desktop companion only with your own workspace. Review local consent switches, choose the least permissive appropriate automation mode, and grant access only to the folders and resources required for the task. Local approvals, account permissions, command expiry and device revocation remain important even after subscription enforcement is enabled.

Unsigned CI installers are intended for internal testing, not customer distribution. Release tags must match the Tauri version and point to a commit on main. The Windows release workflow requires an approved signing environment and verifies Authenticode signatures, publisher subject, timestamp and SHA-256 checksums before creating a draft GitHub release.

### Signing setup (release owner)

Configure the protected GitHub environment `windows-release`:

| Type | Name |
| --- | --- |
| Secret | AZURE_CLIENT_ID |
| Secret | AZURE_CLIENT_SECRET |
| Secret | AZURE_TENANT_ID |
| Variable | MCPOS_SIGNING_ENDPOINT |
| Variable | MCPOS_SIGNING_ACCOUNT |
| Variable | MCPOS_SIGNING_PROFILE |
| Variable | MCPOS_SIGNING_PUBLISHER_SUBJECT |
| Variable | MCPOS_SUPABASE_PUBLISHABLE_KEY |

Use an identity with signing access to the intended certificate profile and validate the legal publisher subject against the certificate. Never commit signing credentials. Do not publish unsigned builds or advertise a production installer until the signed release has been independently verified on a clean supported Windows machine.

Before publication, verify installation, launch, sign-in, pairing, permission prompts, revocation, update/rollback procedure, uninstallation, and the subscription purchase/cancellation journey. Keep the release in draft until all release gates pass.
