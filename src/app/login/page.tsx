"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSent(false);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: (() => {
          const requested = new URLSearchParams(window.location.search).get("next") || "/";
          const safeNext = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
          return window.location.origin + "/auth/callback?next=" + encodeURIComponent(safeNext);
        })(),
        },
      });
      if (authError) throw authError;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your sign-in link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090d14] px-4 py-10 text-slate-100">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white"><ArrowLeft size={14}/> Back to McpOS</Link>
        <section className="rounded-2xl border border-[#252d3a] bg-[#101722] p-6 shadow-2xl sm:p-8">
          <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><Mail size={21}/></div>
          <div className="text-xs font-semibold uppercase tracking-widest text-indigo-300">Secure workspace access</div>
          <h1 className="mt-2 text-2xl font-semibold">Sign in to McpOS</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Enter your authorised email address. We’ll send you a secure, one-time sign-in link. No password or GitHub App is required.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label htmlFor="email" className="block text-xs font-medium text-slate-300">Email address</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="w-full rounded-lg border border-[#30394a] bg-[#0b111a] px-3 py-3 text-sm outline-none focus:border-indigo-400"/>
            <button type="submit" disabled={busy || !email.trim()} className="w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Sending sign-in link…" : "Email me a sign-in link"}</button>
          </form>
          {sent && <div className="mt-4 flex gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs leading-5 text-emerald-200"><CheckCircle2 size={15} className="mt-0.5 shrink-0"/>Check your inbox for the secure sign-in link. If it does not arrive, check your spam folder.</div>}
          {error && <p role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs leading-5 text-rose-200">{error}</p>}
          <div className="mt-6 flex items-start gap-2 border-t border-[#252d3a] pt-4 text-[11px] leading-5 text-slate-500"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-300"/>Access is restricted to email addresses explicitly approved for this McpOS workspace.</div>
        </section>
      </div>
    </main>
  );
}
