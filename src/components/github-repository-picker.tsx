"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, CircleAlert, ExternalLink, Github, LockKeyhole, RefreshCw, Search, Unplug } from "lucide-react";

type Repository = {
  id: number;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  owner: { login: string; avatar_url: string };
};

type GitHubStatus = {
  configured: boolean;
  connected: boolean;
  user: { login: string; avatarUrl: string } | null;
};

export default function GitHubRepositoryPicker() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Repository | null>(null);
  const [error, setError] = useState("");

  const loadRepositories = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/github/repositories", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load repositories.");
      setRepositories(data.repositories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load repositories.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/github/status", { cache: "no-store" });
      const data = await response.json() as GitHubStatus;
      setStatus(data);
      if (data.connected) await loadRepositories();
    } catch {
      setError("Unable to check GitHub connection status.");
    }
  }, [loadRepositories]);

  useEffect(() => {
    void refreshStatus();
    const params = new URLSearchParams(window.location.search);
    const githubMessage = params.get("github");
    if (githubMessage) {
      const messages: Record<string, string> = {
        "not-configured": "Add the GitHub App credentials to the server environment first.",
        denied: "GitHub authorisation was cancelled.",
        "invalid-state": "The GitHub authorisation check failed. Please try connecting again.",
        "token-failed": "GitHub did not issue an access token. Check the App configuration.",
        "profile-failed": "GitHub authorisation succeeded, but the profile could not be read.",
        "connection-failed": "The GitHub connection could not be completed.",
      };
      setError(messages[githubMessage] || "GitHub connection returned an unexpected status.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshStatus]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return repositories.filter((repo) => !term || repo.full_name.toLowerCase().includes(term));
  }, [repositories, query]);

  async function disconnect() {
    await fetch("/api/github/disconnect", { method: "POST" });
    setRepositories([]);
    setSelected(null);
    setExpanded(false);
    await refreshStatus();
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1a2230] text-slate-200"><Github size={19}/></div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">GitHub repositories</div>
            <p className="mt-1 text-xs text-slate-500">
              {status?.connected && status.user ? `Connected as @${status.user.login}` : "Connect a GitHub App to browse repositories you have authorised."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status?.connected ? (
            <>
              <button onClick={() => { setExpanded((value) => !value); if (!expanded && repositories.length === 0) void loadRepositories(); }} className="flex items-center gap-2 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-400">
                {expanded ? "Hide repositories" : "Choose repository"} <ChevronDown size={14}/>
              </button>
              <button onClick={() => void disconnect()} className="flex items-center gap-1.5 rounded-lg border border-[#30394a] px-3 py-2 text-xs text-slate-400 hover:text-white"><Unplug size={13}/>Disconnect</button>
            </>
          ) : (
            <a href="/api/github/connect" aria-disabled={!status?.configured} onClick={(event) => { if (!status?.configured) event.preventDefault(); }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${status?.configured ? "bg-indigo-500 text-white hover:bg-indigo-400" : "cursor-not-allowed border border-[#30394a] text-slate-500"}`}>
              <Github size={14}/>Connect GitHub
            </a>
          )}
        </div>
      </div>

      {!status && <div className="border-t border-[#252d3a] px-5 py-3 text-xs text-slate-500">Checking integration status…</div>}
      {status && !status.configured && !status.connected && (
        <div className="flex gap-2 border-t border-[#252d3a] bg-[#111925] px-4 py-3 text-xs leading-5 text-slate-400 sm:px-5">
          <CircleAlert size={15} className="mt-0.5 shrink-0 text-amber-300"/>
          GitHub App credentials are not configured yet. Add the required server environment variables, then reload this page to connect.
        </div>
      )}
      {selected && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#252d3a] px-4 py-3 text-xs sm:px-5">
          <span className="flex items-center gap-2 text-slate-300"><Check size={14} className="text-emerald-300"/>Selected for this session: <strong>{selected.full_name}</strong></span>
          <a href={selected.html_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200">Open on GitHub <ExternalLink size={12}/></a>
        </div>
      )}
      {expanded && status?.connected && (
        <div className="border-t border-[#252d3a] p-4 sm:p-5">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter repositories…" className="w-full rounded-lg border border-[#30394a] bg-[#0c121b] py-2 pl-9 pr-3 text-xs text-slate-200 outline-none focus:border-indigo-400"/>
            </div>
            <button onClick={() => void loadRepositories()} disabled={loading} className="flex items-center justify-center gap-2 rounded-lg border border-[#30394a] px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><RefreshCw size={13} className={loading ? "animate-spin" : ""}/>Refresh</button>
          </div>
          {loading ? <div className="py-6 text-center text-xs text-slate-500">Loading authorised repositories…</div> : error ? <div className="flex items-center gap-2 py-3 text-xs text-rose-300"><CircleAlert size={14}/>{error}</div> : filtered.length === 0 ? <div className="py-6 text-center text-xs text-slate-500">{repositories.length ? "No repositories match that filter." : "No repositories found. Install the GitHub App on an account and grant it repository access."}</div> : (
            <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
              {filtered.map((repo) => (
                <button key={repo.id} onClick={() => setSelected(repo)} className={`flex min-w-0 items-start gap-3 rounded-lg border p-3 text-left transition ${selected?.id === repo.id ? "border-indigo-400 bg-indigo-500/10" : "border-[#30394a] bg-[#101722] hover:border-slate-500"}`}>
                  <div className="mt-0.5 shrink-0 text-slate-400">{repo.private ? <LockKeyhole size={14}/> : <Github size={14}/>}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">{repo.full_name}</div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{repo.description || "No description"}</div>
                    <div className="mt-2 text-[10px] text-slate-600">Default branch: {repo.default_branch}</div>
                  </div>
                  {selected?.id === repo.id && <Check size={14} className="shrink-0 text-emerald-300"/>}
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-[10px] leading-4 text-slate-600">Repository selection is currently session-only. Persistent projects and repository write permissions will be added in later milestones.</p>
        </div>
      )}
      {error && !expanded && <div className="border-t border-[#252d3a] px-4 py-3 text-xs text-rose-300">{error}</div>}
    </section>
  );
}
