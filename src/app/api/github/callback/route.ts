import { NextRequest, NextResponse } from "next/server";
import {
  GITHUB_STATE_COOKIE,
  setGitHubSession,
  type GitHubSession,
} from "@/lib/github-session";

export const dynamic = "force-dynamic";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
};

type GitHubUser = {
  login?: string;
  avatar_url?: string;
};

export async function GET(request: NextRequest) {
  const url = new URL("/", request.url);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(GITHUB_STATE_COOKIE)?.value;
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError || !code || !state || !expectedState || state !== expectedState) {
    url.searchParams.set("github", oauthError ? "denied" : "invalid-state");
    const failed = NextResponse.redirect(url);
    failed.cookies.set(GITHUB_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return failed;
  }

  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.GITHUB_SESSION_SECRET) {
    url.searchParams.set("github", "not-configured");
    return NextResponse.redirect(url);
  }

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        state,
      }),
      cache: "no-store",
    });
    const tokenData = await tokenResponse.json() as TokenResponse;
    if (!tokenResponse.ok || !tokenData.access_token) {
      url.searchParams.set("github", "token-failed");
      return NextResponse.redirect(url);
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenData.access_token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    const user = await userResponse.json() as GitHubUser;
    if (!userResponse.ok || !user.login || !user.avatar_url) {
      url.searchParams.set("github", "profile-failed");
      return NextResponse.redirect(url);
    }

    const session: GitHubSession = {
      accessToken: tokenData.access_token,
      login: user.login,
      avatarUrl: user.avatar_url,
      expiresAt: typeof tokenData.expires_in === "number"
        ? Date.now() + tokenData.expires_in * 1000
        : null,
    };
    const success = NextResponse.redirect(url);
    success.cookies.set(GITHUB_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    setGitHubSession(success, session);
    return success;
  } catch {
    url.searchParams.set("github", "connection-failed");
    return NextResponse.redirect(url);
  }
}
