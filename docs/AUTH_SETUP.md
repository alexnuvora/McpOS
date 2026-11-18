# McpOS dashboard authentication setup

McpOS uses Supabase Auth email magic links with cookie-based SSR sessions.

## Netlify environment

Set the following on the `mcpos-dashboard` site for Production and Deploy Previews as appropriate:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://kvwwabuqydwsbhlcqxwz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Copy the publishable key from Supabase Project Settings > API Keys |
| `SUPABASE_URL` | `https://kvwwabuqydwsbhlcqxwz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role/secret key from Supabase Project Settings > API Keys |
| `MCPOS_ALLOWED_EMAILS` | Comma-separated list of approved sign-in email addresses |

Never put the service-role/secret key in a `NEXT_PUBLIC_` variable or in Git.

## Supabase Auth URL configuration

In Authentication > URL Configuration:

- Site URL: `https://mcpos-dashboard.netlify.app`
- Redirect URL: `https://mcpos-dashboard.netlify.app/auth/callback`
- Local redirect URL: `http://localhost:3000/auth/callback`

Ensure the Email provider is enabled. Users receive a one-time email link; no password or GitHub App is needed.

## Access control

The application checks the verified Supabase Auth user email against `MCPOS_ALLOWED_EMAILS` on the callback and on every device-management API request. Keep this list limited to intended workspace users. Supabase Auth sessions are stored in secure, HTTP-only cookies by `@supabase/ssr`. Device records continue to be scoped to `auth.users.id`; no GitHub identity mapping is used by the dashboard.
