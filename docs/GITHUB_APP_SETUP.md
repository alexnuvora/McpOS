# GitHub App setup

This milestone uses a GitHub App OAuth flow for **read-only repository discovery**. It does not create commits, open pull requests, or execute code.

## 1. Create the GitHub App

In GitHub, open **Settings → Developer settings → GitHub Apps → New GitHub App**.

Use these values:

- **GitHub App name:** McpOS (or another unique name)
- **Homepage URL:** your deployed McpOS HTTPS URL
- **Callback URL:** `https://YOUR_HOST/api/github/callback`
- Enable **Request user authorization (OAuth) during installation** / user-to-server authorization.
- Set the **Setup URL** to your deployed McpOS URL if GitHub offers that field.

For local development, add `http://localhost:3000/api/github/callback` as the callback URL where GitHub permits it. The callback URL in the App settings must exactly match `GITHUB_APP_CALLBACK_URL`.

## 2. Set minimum permissions

Under **Repository permissions**, use:

- **Metadata:** Read-only (required by GitHub)
- **Contents:** Read-only
- **Pull requests:** Read-only

Do not grant Contents write, Administration, Actions write, Secrets write, or other write permissions for this milestone.

The app can only list repositories in installations where the signed-in user has access and the App has been installed.

## 3. Configure the server environment

Copy the Client ID and generate a Client Secret from the App settings. Set these variables in the server environment (not in browser-exposed variables):

```dotenv
GITHUB_APP_CLIENT_ID=your_client_id
GITHUB_APP_CLIENT_SECRET=your_client_secret
GITHUB_APP_CALLBACK_URL=https://YOUR_HOST/api/github/callback
GITHUB_SESSION_SECRET=at-least-32-random-characters
```

Generate a session secret with:

```bash
openssl rand -base64 48
```

Keep the Client Secret and session secret private. Never commit them or use a `NEXT_PUBLIC_` prefix.

## 4. Install the App

Use **Install App** in the GitHub App settings and install it on the personal account or organisation containing the repositories you want McpOS to list. Select only the repositories you want to expose.

Then return to McpOS and choose **Connect GitHub**. Authorise the App. The repository picker should show the repositories available to that account and installation.

## 5. What is and is not enabled

Enabled:
- OAuth state verification.
- Encrypted AES-GCM HTTP-only session cookie.
- Read-only listing of repositories available through the App installation.
- Client-side filtering and session-only selection.

Not enabled:
- Persistent project records.
- Clone, branch, commit, push, merge, or pull-request mutations.
- Terminal access, agent execution, or deployments.

The next milestone should add durable project records and per-project membership/authorization before enabling any write operations.
