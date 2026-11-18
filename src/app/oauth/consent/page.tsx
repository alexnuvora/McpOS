"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, LockKeyhole, AlertTriangle } from "lucide-react";

type Grant = { clientId: string; clientName: string; redirectUri: string; scopes: string[]; state?: string };
const labels: Record<string, string> = {
  "workspace.read": "View paired-device status and McpOS workspace information",
  "desktop.status": "Request read-only status from the paired Windows computer",
  "screen.capture": "Request a one-time screenshot when the Windows consent switch is enabled",
  "screen.accessibility": "Read a limited list of open Windows application windows",
  "files.read": "Read text files only inside folders you separately approve on Windows",
  "input.pointer": "Request mouse clicks, each requiring a separate Windows approval",
  "input.keyboard": "Request text entry, each requiring a separate Windows approval",
  "browser.control": "Use the isolated browser, with local approval for navigation and page actions",
};

export default function OAuthConsentPage() {
  const [request, setRequest] = useState("");
  const [grant, setGrant] = useState<Grant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const encoded = new URLSearchParams(window.location.search).get("request") || "";
      setRequest(encoded);
      try {
        const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
        const parsed = JSON.parse(atob(normalized)) as Grant;
        if (!parsed.clientName || !Array.isArray(parsed.scopes)) throw new Error("Invalid request");
        setGrant(parsed);
      } catch {
        setError("This authorisation request is invalid or has expired. Return to ChatGPT and reconnect McpOS.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function approve() {
    if (!request || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/oauth/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not approve the connection.");
      window.location.assign(data.redirectUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not approve the connection.");
      setBusy(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#090d14] px-4 py-10 text-slate-100">
    <section className="w-full max-w-xl rounded-2xl border border-[#293345] bg-[#111824] p-6 shadow-2xl sm:p-8">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><ShieldCheck size={24}/></div>
      <div className="text-xs font-semibold uppercase tracking-widest text-indigo-300">McpOS secure authorisation</div>
      <h1 className="mt-2 text-2xl font-semibold">Connect an AI assistant?</h1>
      {grant ? <>
        <p className="mt-3 text-sm leading-6 text-slate-400"><strong className="text-white">{grant.clientName}</strong> is requesting access to your McpOS workspace. Review the permissions below before continuing.</p>
        <div className="mt-5 rounded-xl border border-[#293345] bg-[#0b111a] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><LockKeyhole size={16} className="text-emerald-300"/> Requested permissions</div>
          <ul className="space-y-3">{grant.scopes.map(scope=><li key={scope} className="flex gap-2 text-sm"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-400"/><span><strong>{scope}</strong><span className="mt-0.5 block text-xs leading-5 text-slate-400">{labels[scope] || "Access to the requested McpOS capability"}</span></span></li>)}</ul>
        </div>
        <div className="mt-4 flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100"><AlertTriangle size={15} className="mt-0.5 shrink-0"/>Windows screen, file, browser and input controls still require their separate local permissions. Mouse, keyboard and browser actions still require a fresh approval on your PC.</div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <a href="/integrations" className="rounded-lg border border-[#39465a] px-4 py-3 text-center text-sm text-slate-300 hover:bg-white/5">Cancel</a>
          <button onClick={()=>void approve()} disabled={busy} className="rounded-lg bg-indigo-500 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">{busy ? "Approving…" : "Approve connection"}</button>
        </div>
      </> : <p className="mt-3 text-sm text-slate-400">{error || "Loading authorisation request…"}</p>}
      {error && grant && <p role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-200">{error} If you are signed out, <a className="underline" href={"/login?next="+encodeURIComponent(window.location.pathname+window.location.search)}>sign in</a> and retry.</p>}
      <p className="mt-6 border-t border-[#293345] pt-4 text-[11px] leading-5 text-slate-500">Only approve if you initiated this connection. You can revoke this AI session at any time from McpOS → AI connections.</p>
    </section>
  </main>;
}
