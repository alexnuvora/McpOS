"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, ShieldCheck } from "lucide-react";

type AuditEvent = { id: number; device_id: string | null; event_type: string; outcome: "success" | "denied" | "failure"; metadata: Record<string, unknown>; created_at: string };

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/audit?limit=200", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load audit history.");
      setEvents(data.events as AuditEvent[]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load audit history."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const id = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(id); }, [load]);
  return <main className="min-h-screen bg-[#0a0e15] px-4 py-8 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <Link href="/" className="mb-7 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={15}/> Back to dashboard</Link>
      <div className="mb-7 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3"><div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-300"><ShieldCheck size={22}/></div><div><div className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Security</div><h1 className="mt-1 text-3xl font-semibold">Audit history</h1><p className="mt-2 text-sm text-slate-400">Recent device pairing, capability requests, approvals and revocations recorded by McpOS.</p></div></div>
        <button onClick={() => void load()} disabled={loading} aria-label="Refresh audit history" className="rounded-lg border border-[#30394a] p-2 text-slate-400 hover:text-white"><RefreshCw size={15}/></button>
      </div>
      <section className="overflow-hidden rounded-2xl border border-[#293345] bg-[#111824]">
        <div className="flex items-center justify-between border-b border-[#293345] px-5 py-4"><div className="text-sm font-semibold">Latest events</div><span className="text-xs text-slate-500">{events.length} shown · maximum 200</span></div>
        {error && <p className="p-5 text-sm text-rose-300">{error}</p>}
        {loading ? <p className="p-5 text-sm text-slate-500">Loading audit history…</p> : events.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No audit events have been recorded yet.</p> : <div className="divide-y divide-[#252d3a]">{events.map(event => <div key={event.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[190px_1fr_auto] sm:items-center"><div className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</div><div className="min-w-0"><div className="break-all text-sm font-medium text-slate-200">{event.event_type}</div><div className="mt-1 break-all text-[11px] text-slate-500">{Object.entries(event.metadata ?? {}).map(([key,value]) => key + ": " + String(value)).join(" · ") || (event.device_id ? "Device " + event.device_id : "Workspace event")}</div></div><span className={"text-xs " + (event.outcome === "success" ? "text-emerald-300" : event.outcome === "denied" ? "text-amber-300" : "text-rose-300")}>{event.outcome}</span></div>)}</div>}
      </section>
      <p className="mt-4 text-xs leading-5 text-slate-500">This view shows the latest 200 recorded events. It does not yet represent a tamper-proof or externally retained compliance log.</p>
    </div>
  </main>;
}
