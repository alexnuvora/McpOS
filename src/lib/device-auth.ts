import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getGitHubSession } from "@/lib/github-session";

const supabaseUrl = () => (process.env.SUPABASE_URL ?? "https://kvwwabuqydwsbhlcqxwz.supabase.co").replace(/\/$/, "");
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

type DeviceAccount = { userId: string; githubId: number; login: string };
type AccountResult = { account: DeviceAccount } | { response: NextResponse };

async function rest(path: string, init: RequestInit = {}) {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) throw new Error("McpOS device service is not configured.");
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function getDeviceAccount(request: NextRequest): Promise<AccountResult> {
  const session = getGitHubSession(request);
  if (!session || !Number.isSafeInteger(session.githubId)) {
    return { response: NextResponse.json({ error: "Connect your GitHub account first." }, { status: 401 }) };
  }

  const githubResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${session.accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!githubResponse.ok) {
    return { response: NextResponse.json({ error: "Your GitHub session has expired. Reconnect GitHub." }, { status: 401 }) };
  }
  const githubUser = await githubResponse.json() as { id?: number; login?: string };
  if (githubUser.id !== session.githubId || githubUser.login !== session.login) {
    return { response: NextResponse.json({ error: "GitHub identity could not be verified." }, { status: 401 }) };
  }

  try {
    const existing = await rest(`mcpos_github_accounts?select=user_id&github_user_id=eq.${session.githubId}&limit=1`);
    if (!existing.ok) throw new Error("Could not look up McpOS account.");
    const rows = await existing.json() as Array<{ user_id: string }>;
    let userId = rows[0]?.user_id;

    if (!userId) {
      const randomPassword = randomBytes(48).toString("base64url");
      const created = await fetch(`${supabaseUrl()}/auth/v1/admin/users`, {
        method: "POST",
        headers: {
          apikey: serviceKey()!,
          Authorization: `Bearer ${serviceKey()!}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: `github-${session.githubId}@accounts.mcpos.invalid`,
          password: randomPassword,
          email_confirm: true,
          user_metadata: { github_login: session.login },
          app_metadata: { identity_provider: "github" },
        }),
        cache: "no-store",
      });
      if (!created.ok) throw new Error("Could not provision the McpOS account.");
      const createdUser = await created.json() as { id?: string };
      if (!createdUser.id) throw new Error("McpOS account provisioning returned no user ID.");
      userId = createdUser.id;

      const mapped = await rest("mcpos_github_accounts", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ github_user_id: session.githubId, github_login: session.login, user_id: userId }),
      });
      if (!mapped.ok) throw new Error("Could not link your GitHub identity to McpOS.");
    }

    return { account: { userId, githubId: session.githubId, login: session.login } };
  } catch (error) {
    console.error("McpOS account resolution failed:", error);
    return { response: NextResponse.json({ error: "McpOS account service is temporarily unavailable." }, { status: 503 }) };
  }
}

export async function supabaseRest(path: string, init: RequestInit = {}) {
  return rest(path, init);
}

export function newPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  return Array.from(bytes, byte => alphabet[byte & 31]).join("");
}
