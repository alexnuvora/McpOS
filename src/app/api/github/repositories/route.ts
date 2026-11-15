import { NextRequest, NextResponse } from "next/server";
import { getGitHubSession } from "@/lib/github-session";

export const dynamic = "force-dynamic";

type Installation = { id: number };
type Repository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  owner: { login: string; avatar_url: string };
};

async function githubGet<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(response.status === 403 ? "GitHub denied repository access. Check the App installation and permissions." : "GitHub could not return repository data.");
  }
  return response.json() as Promise<T>;
}

export async function GET(request: NextRequest) {
  const session = getGitHubSession(request);
  if (!session) {
    return NextResponse.json({ error: "Connect GitHub to view repositories." }, { status: 401 });
  }

  try {
    const installations = await githubGet<{ installations: Installation[] }>(
      "https://api.github.com/user/installations?per_page=100",
      session.accessToken,
    );
    const repositories: Repository[] = [];
    for (const installation of installations.installations) {
      const result = await githubGet<{ repositories: Repository[] }>(
        `https://api.github.com/user/installations/${installation.id}/repositories?per_page=100`,
        session.accessToken,
      );
      repositories.push(...result.repositories);
    }
    const unique = Array.from(new Map(repositories.map((repo) => [repo.id, repo])).values())
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
    return NextResponse.json({
      user: { login: session.login, avatarUrl: session.avatarUrl },
      repositories: unique,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to load repositories.",
    }, { status: 502 });
  }
}
