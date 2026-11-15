import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { GITHUB_STATE_COOKIE } from "@/lib/github-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const callbackUrl = process.env.GITHUB_APP_CALLBACK_URL;
  if (
    !clientId ||
    !callbackUrl ||
    !process.env.GITHUB_APP_CLIENT_SECRET ||
    !process.env.GITHUB_SESSION_SECRET ||
    process.env.GITHUB_SESSION_SECRET.length < 32
  ) {
    return NextResponse.redirect(new URL("/?github=not-configured", request.url));
  }

  const state = randomBytes(32).toString("hex");
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "false");

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(GITHUB_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
