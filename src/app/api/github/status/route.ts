import { NextRequest, NextResponse } from "next/server";
import { getGitHubSession } from "@/lib/github-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const configured = Boolean(
    process.env.GITHUB_APP_CLIENT_ID &&
    process.env.GITHUB_APP_CLIENT_SECRET &&
    process.env.GITHUB_SESSION_SECRET &&
    process.env.GITHUB_APP_CALLBACK_URL
  );
  const session = getGitHubSession(request);
  return NextResponse.json({
    configured,
    connected: Boolean(session),
    user: session ? { login: session.login, avatarUrl: session.avatarUrl } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
