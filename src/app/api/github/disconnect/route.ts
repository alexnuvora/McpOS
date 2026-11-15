import { NextResponse } from "next/server";
import { clearGitHubSession } from "@/lib/github-session";

export async function POST() {
  const response = NextResponse.json({ disconnected: true });
  clearGitHubSession(response);
  return response;
}
