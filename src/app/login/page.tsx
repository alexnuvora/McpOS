"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import type { FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Mail, ShieldCheck } from "lucide-react";
type Turnstile = { render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string; reset: (id: string) => void; remove: (id: string) => void };
function turnstile() { return (window as Window & { turnstile?: Turnstile }).turnstile; }


export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"password" | "register" | "magic" | "recovery">("password");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [error, setError] = useState("");

  const [config, setConfig] = useState<{ publicRegistration: boolean; captchaSiteKey: string | null } | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    setPasswordUpdated(new URLSearchParams(window.location.search).get("password") === "updated");
    fetch("/api/auth/login", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Sign-in configuration unavailable");
      const result = await response.json();
      if (!stopped) setConfig(result);
    }).catch(() => { if (!stopped) setError("Sign-in configuration unavailable. Refresh and try again."); });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    const api = turnstile();
    const container = containerRef.current;
    if (!scriptReady || !config?.captchaSiteKey || !api || !container) return;
    const id = api.render(container, {
      sitekey: config.captchaSiteKey,
      callback: setCaptchaToken,
      "expired-callback": () => setCaptchaToken(""),
      "error-callback": () => setCaptchaToken(""),
    });
    widgetRef.current = id;
    return () => { api.remove(id); widgetRef.current = null; };
  }, [config?.captchaSiteKey, scriptReady]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || (config.captchaSiteKey && !captchaToken)) return;
    if (mode === "register" && password !== confirmation) { setError("Passwords do not match."); return; }
    setBusy(true);
    setError("");
    setSent(false);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, email: email.trim(), password: mode === "password" || mode === "register" ? password : undefined, next: new URLSearchParams(window.location.search).get("next") || "/", captchaToken: captchaToken || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not complete your request.");
      if (mode === "password") {
        const target = new URL(result.next || "/", window.location.origin);
        if (target.origin !== window.location.origin) throw new Error("Invalid sign-in redirect.");
        window.location.assign(target.href); return;
      }
      setPassword(""); setConfirmation(""); setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete your request.");
    } finally {
      setBusy(false);
      setCaptchaToken("");
      if (widgetRef.current) turnstile()?.reset(widgetRef.current);
    }
  }

  function chooseMode(next: typeof mode) { setMode(next); setPassword(""); setConfirmation(""); setSent(false); setError(""); setCaptchaToken(""); if (widgetRef.current) turnstile()?.reset(widgetRef.current); }
  const passwordRequired = mode === "password" || mode === "register";
  const title = mode === "register" ? "Create your McpOS account" : mode === "recovery" ? "Reset your password" : "Sign in to McpOS";
  const submitLabel = mode === "password" ? "Sign in" : mode === "register" ? "Create account" : mode === "recovery" ? "Send password reset link" : "Email me a sign-in link";
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090d14] px-4 py-10 text-slate-100">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white"><ArrowLeft size={14}/> Back to McpOS</Link>
        <section className="rounded-2xl border border-[#252d3a] bg-[#101722] p-6 shadow-2xl sm:p-8">
          <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><Mail size={21}/></div>
          <div className="text-xs font-semibold uppercase tracking-widest text-indigo-300">Secure workspace access</div>
          <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{mode === "recovery" ? "Enter your email to receive a password reset link." : mode === "register" ? "Register with your email and verify it to activate your account." : mode === "magic" ? "Enter your email to receive a one-time sign-in link." : "Sign in securely with your email and password."}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label htmlFor="email" className="block text-xs font-medium text-slate-300">Email address</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="w-full rounded-lg border border-[#30394a] bg-[#0b111a] px-3 py-3 text-sm outline-none focus:border-indigo-400"/>
            {passwordRequired && <div className="space-y-2"><label htmlFor="password" className="block text-xs font-medium text-slate-300">Password</label><input id="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={mode === "register" ? 12 : 1} maxLength={mode === "register" ? 72 : 1024} value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-lg border border-[#30394a] bg-[#0b111a] px-3 py-3 text-sm outline-none focus:border-indigo-400"/>{mode === "register" && <p className="text-xs text-slate-400">Use at least 12 characters (maximum 72 UTF-8 bytes).</p>}</div>}
            {mode === "register" && <div className="space-y-2"><label htmlFor="confirm-password" className="block text-xs font-medium text-slate-300">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} className="w-full rounded-lg border border-[#30394a] bg-[#0b111a] px-3 py-3 text-sm outline-none focus:border-indigo-400"/></div>}
            {config?.captchaSiteKey && <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setScriptReady(true)} onError={() => setError("Security check failed to load. Refresh and try again.")}/><div ref={containerRef}/></>}
            <button type="submit" disabled={busy || !email.trim() || !config || Boolean(config.captchaSiteKey && !captchaToken) || (passwordRequired && !password) || (mode === "register" && (password.length < 12 || password !== confirmation))} className="w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Please wait…" : submitLabel}</button>
          </form>
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-3 text-xs text-indigo-300">{mode !== "password" && <button disabled={busy} type="button" onClick={() => chooseMode("password")} className="hover:underline">Sign in with password</button>}{mode !== "register" && <button disabled={busy} type="button" onClick={() => chooseMode("register")} className="hover:underline">Create an account</button>}{mode !== "recovery" && <button disabled={busy} type="button" onClick={() => chooseMode("recovery")} className="hover:underline">Forgot password / set password</button>}{mode !== "magic" && <button disabled={busy} type="button" onClick={() => chooseMode("magic")} className="hover:underline">Use a sign-in link</button>}</div>
          {passwordUpdated && <p className="mt-4 text-xs text-emerald-200" role="status">Password saved. You can now sign in with your email and password.</p>}
          {sent && <div className="mt-4 flex gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs leading-5 text-emerald-200"><CheckCircle2 size={15} className="mt-0.5 shrink-0"/>{mode === "register" ? "If your email is eligible, check your inbox for a verification link. Already registered? Use password recovery." : mode === "recovery" ? "If your email is eligible, check your inbox for a password reset link." : "If your email is eligible, check your inbox for a secure sign-in link."} Check your spam folder if needed.</div>}
          {error && <p role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-xs leading-5 text-rose-200">{error}</p>}
          <div className="mt-6 flex items-start gap-2 border-t border-[#252d3a] pt-4 text-[11px] leading-5 text-slate-500"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-300"/>{config?.publicRegistration ? "Public registration is available for sandbox testing only." : "Access is restricted to email addresses explicitly approved for this McpOS workspace."}</div>
        </section>
      </div>
    </main>
  );
}
