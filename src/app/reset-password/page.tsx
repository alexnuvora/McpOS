"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";

export default function ResetPasswordPage() {
  const [password,setPassword] = useState("");
  const [confirm,setConfirm] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({password}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not set password.");
      setPassword(""); setConfirm(""); window.location.assign("/login?password=updated");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not set password."); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-[#090d14] px-4 text-slate-100">
    <section className="w-full max-w-md rounded-2xl border border-[#252d3a] bg-[#101722] p-8">
      <h1 className="text-2xl font-semibold">Set your McpOS password</h1>
      <p className="mt-3 text-sm text-slate-400">Use your verified recovery session. Choose at least 12 characters and no more than 72 UTF-8 bytes.</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block text-sm" htmlFor="password">New password</label>
        <input className="w-full rounded-lg border border-slate-700 bg-[#0b111a] p-3" id="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={password} onChange={e=>setPassword(e.target.value)}/>
        <label className="block text-sm" htmlFor="confirm">Confirm password</label>
        <input className="w-full rounded-lg border border-slate-700 bg-[#0b111a] p-3" id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={e=>setConfirm(e.target.value)}/>
        <button className="w-full rounded-lg bg-indigo-500 p-3 text-sm font-semibold disabled:opacity-50" disabled={busy || password.length < 12 || password !== confirm}>{busy ? "Saving…" : "Save password"}</button>
      </form>
      {error && <p className="mt-4 text-sm text-rose-300" role="alert">{error}</p>}
      <Link href="/login" className="mt-6 block text-sm text-indigo-300">Back to sign in</Link>
    </section>
  </main>;
}
