import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const GITHUB_SESSION_COOKIE = "mcpos_github_session";
export const GITHUB_STATE_COOKIE = "mcpos_github_oauth_state";

export type GitHubSession = {
  accessToken: string;
  login: string;
  githubId: number;
  avatarUrl: string;
  expiresAt: number | null;
};

function sessionKey(): Buffer {
  const secret = process.env.GITHUB_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("GITHUB_SESSION_SECRET must contain at least 32 characters.");
  }
  return scryptSync(secret, "mcpos-github-session-v1", 32);
}

export function sealSession(session: GitHubSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function openSession(value: string | undefined): GitHubSession | null {
  if (!value) return null;
  try {
    const packed = Buffer.from(value, "base64url");
    if (packed.length < 29) return null;
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as GitHubSession;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.login !== "string" ||
      !Number.isSafeInteger(parsed.githubId) ||
      typeof parsed.avatarUrl !== "string" ||
      (parsed.expiresAt !== null && typeof parsed.expiresAt !== "number")
    ) return null;
    if (parsed.expiresAt !== null && Date.now() >= parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getGitHubSession(request: NextRequest): GitHubSession | null {
  return openSession(request.cookies.get(GITHUB_SESSION_COOKIE)?.value);
}

export function setGitHubSession(response: NextResponse, session: GitHubSession): void {
  response.cookies.set(GITHUB_SESSION_COOKIE, sealSession(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearGitHubSession(response: NextResponse): void {
  response.cookies.set(GITHUB_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
