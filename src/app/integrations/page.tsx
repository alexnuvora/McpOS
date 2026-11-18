"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

type Client = { id: string; client_name: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null };

export default function IntegrationsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("Claude Desktop");
  const [allowScreenCapture, setAllowScreenCapture] = useState(false);
  const [allowAccessibility, setAllowAccessibility] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mcp/clients", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load MCP clients.");
      setClients(data.clients as Client[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load MCP clients.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);

  async function createClient() {
    setBusy(true); setError(""); setMessage(""); setToken("");
    try {
      const response = await fetch("/api/mcp/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_name: name, scopes: [...(allowScreenCapture ? ["screen.capture"] : []), ...(allowAccessibility ? ["screen.accessibility"] : [])] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create MCP client.");
      setToken(data.token);
      setMessage("Client created. Copy the token now; it will not be shown again.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create MCP client.");
    } finally { setBusy(false); }
  }

  async function revokeClient(id: string) {
    if (!window.confirm("Revoke this AI client? It will immediately lose access to McpOS.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/mcp/clients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not revoke MCP client.");
      setMessage("AI client revoked.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke MCP client.");
    } finally { setBusy(false); }
  }

  async function copyToken() {
    try { await navigator.clipboard.writeText(token); setMessage("Token copied. Store it securely in your AI client."); }
    catch { setMessage("Select and copy the token manually."); }
  }

  return <main className="min-h-screen bg-[#0a0e15] px-4 py-8 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="mb-7 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={15}/> Back to dashboard</Link>
      <div className="mb-8 flex items-start gap-3">
        <div className="rounded-xl bg-indigo-500/15 p-3 text-indigo-300"><KeyRound size={22}/></div>
        <div><div className="text-xs font-semibold uppercase tracking-widest text-indigo-300">Integrations</div><h1 className="mt-1 text-3xl font-semibold">AI client connections</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Create separate, revocable credentials for Claude and other compatible MCP clients. Credentials are shown only once and stored as hashes.</p></div>
      </div>

      <section className="mb-6 rounded-2xl border border-[#293345] bg-[#111824] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={17} className="text-emerald-300"/> Permission-first access</div>
        <p className="text-sm leading-6 text-slate-400">Every key can read paired-device status. Screen capture is an optional additional scope and still requires the visible local consent switch to be ON in the Windows companion. Mouse, keyboard, browser and file capabilities remain unavailable until their separate approval workflows are implemented.</p>
        <div className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
          <div className="rounded-lg bg-[#0c121c] p-3">Default: workspace.read, desktop.status</div>
          <div className="rounded-lg bg-[#0c121c] p-3">Optional: screen.capture / screen.accessibility (local consent required)</div>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-[#293345] bg-[#111824] p-5">
        <h2 className="text-base font-semibold">Create an AI client key</h2>
        <p className="mt-1 text-xs text-slate-500">Use one key per AI client so you can revoke access independently.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input value={name} onChange={event=>setName(event.target.value)} maxLength={80} placeholder="Client name" className="min-w-0 flex-1 rounded-lg border border-[#30394a] bg-[#0c121c] px-3 py-2.5 text-sm outline-none focus:border-indigo-400"/>
          <label className="flex items-center gap-2 rounded-lg border border-[#30394a] px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={allowScreenCapture} onChange={event=>setAllowScreenCapture(event.target.checked)} className="accent-indigo-500"/> Allow screen capture for this key</label>
          <label className="flex items-center gap-2 rounded-lg border border-[#30394a] px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={allowAccessibility} onChange={event=>setAllowAccessibility(event.target.checked)} className="accent-indigo-500"/> Allow Windows application understanding</label>
          <button disabled={busy||!name.trim()} onClick={()=>void createClient()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"><Plus size={15}/> Generate key</button>
        </div>
        {token&&<div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-4">
          <div className="mb-2 text-xs font-semibold text-emerald-300">New client token — copy it now</div>
          <div className="flex flex-col gap-2 sm:flex-row"><code className="min-w-0 flex-1 break-all rounded-lg bg-[#080d14] p-3 text-xs text-slate-200">{token}</code><button onClick={()=>void copyToken()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-400/30 px-3 py-2 text-xs text-emerald-200"><Copy size={14}/> Copy token</button></div>
          <p className="mt-2 text-xs text-slate-400">Do not share this key in chat or commit it to GitHub. If lost, revoke it and generate another.</p>
        </div>}
        {message&&<p className="mt-3 text-xs text-emerald-300">{message}</p>}
        {error&&<p className="mt-3 text-xs text-rose-300">{error}</p>}
      </section>

      <section className="rounded-2xl border border-[#293345] bg-[#111824] p-5">
        <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Registered AI clients</h2><p className="mt-1 text-xs text-slate-500">Revoked keys cannot be used again.</p></div><button onClick={()=>void load()} disabled={busy} aria-label="Refresh" className="rounded-lg border border-[#30394a] p-2 text-slate-400 hover:text-white"><RefreshCw size={15}/></button></div>
        {clients.length===0?<p className="rounded-lg border border-dashed border-[#30394a] p-5 text-center text-sm text-slate-500">No AI clients created yet.</p>:<div className="space-y-2">{clients.map(client=><div key={client.id} className="flex flex-col justify-between gap-3 rounded-xl border border-[#252d3a] bg-[#0c121c] p-4 sm:flex-row sm:items-center"><div className="min-w-0"><div className="font-medium">{client.client_name}</div><div className="mt-1 text-xs text-slate-500">Created {new Date(client.created_at).toLocaleString()} · {client.scopes.join(", ")}</div><div className="mt-1 text-xs text-slate-500">{client.revoked_at?"Revoked":client.last_used_at?"Last used "+new Date(client.last_used_at).toLocaleString():"Never used"}</div></div>{!client.revoked_at&&<button disabled={busy} onClick={()=>void revokeClient(client.id)} className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-rose-400/20 px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/10 disabled:opacity-50"><Trash2 size={13}/> Revoke</button>}</div>)}</div>}
      </section>
      <section className="mt-6 rounded-2xl border border-[#293345] bg-[#111824] p-5">
        <h2 className="font-semibold">MCP server address</h2>
        <code className="mt-3 block break-all rounded-lg bg-[#080d14] p-3 text-sm text-indigo-200">https://mcpos-dashboard.netlify.app/api/mcp</code>
        <p className="mt-2 text-xs leading-5 text-slate-500">Use this URL with a compatible remote MCP client and the generated bearer token. Claude Desktop instructions will be provided once this release passes CI and is deployed.</p>
      </section>
    </div>
  </main>;
}
