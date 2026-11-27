"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

const plans = [
  { id: "personal", name: "Personal", price: "9.99" },
  { id: "professional", name: "Professional", price: "19.99" },
  { id: "business", name: "Business", price: "49.99" },
] as const;

export default function BillingPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [subscriptions, setSubscriptions] = useState<Array<{ id: string; plan: string | null; status: string; currentPeriodEnd: number | null; cancelAtPeriodEnd: boolean; active: boolean }>>([]);
  const [statusMessage, setStatusMessage] = useState("Checking subscriptions…");
  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const response = await fetch("/api/billing/status", { cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in to view your subscriptions." : "Subscription status unavailable.");
        const result = await response.json();
        if (!stopped) {
          setSubscriptions(result.subscriptions);
          setStatusMessage(result.enabled ? (result.subscriptions.length ? "" : "No subscriptions found. Recent payments may take a moment to appear; refresh to check.") : "Sandbox billing is disabled.");
        }
      } catch (err) { if (!stopped) setStatusMessage(err instanceof Error ? err.message : "Subscription status unavailable."); }
    }
    void load();
    return () => { stopped = true; };
  }, []);
  async function portal(subscriptionId: string) {
    setBusy(subscriptionId); setError("");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open portal.");
      const target = new URL(result.url);
      if (target.origin !== "https://billing.stripe.com") throw new Error("Invalid portal destination.");
      window.location.assign(target.href);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not open portal."); }
    finally { setBusy(null); }
  }
  async function checkout(plan: string) {
    setBusy(plan); setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }),
      });
      const result = await response.json();
      if (response.status === 401) { window.location.assign("/login?next=%2Fbilling"); return; }
      if (!response.ok) throw new Error(result.error || "Could not start checkout.");
      const target = new URL(result.url);
      if (target.origin !== "https://checkout.stripe.com") throw new Error("Invalid checkout destination.");
      window.location.assign(target.href);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start checkout."); }
    finally { setBusy(null); }
  }
  return <main className="min-h-screen bg-[#090d14] px-6 py-12 text-slate-100">
    <div className="mx-auto max-w-5xl">
      <Link href="/" className="text-sm text-indigo-300 hover:underline">Back to dashboard</Link>
      <h1 className="mt-8 text-3xl font-semibold">McpOS subscriptions</h1>
      <p className="mt-3 text-slate-400">Development preview — sandbox payments only. Plans are not yet commercially available.</p>
      <p className="mt-2 text-sm text-slate-400">Completing checkout does not currently activate desktop access.</p>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {plans.map(plan => <section key={plan.id} className="rounded-xl border border-slate-700 bg-[#101722] p-6">
          <h2 className="text-lg font-semibold">{plan.name}</h2>
          <p className="mt-4 text-3xl font-semibold">£{plan.price}<span className="text-sm font-normal text-slate-400"> / month</span></p>
          <button type="button" disabled={busy !== null} onClick={() => void checkout(plan.id)} className="mt-6 w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold disabled:opacity-50">{busy === plan.id ? "Opening checkout…" : "Test checkout"}</button>
        </section>)}
      </div>
      <section className="mt-10 rounded-xl border border-slate-700 p-6">
        <h2 className="text-xl font-semibold">Your subscriptions</h2>
        {statusMessage && <p className="mt-3 text-sm text-slate-400">{statusMessage}</p>}
        {subscriptions.map(sub => <div key={sub.id} className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-4">
          <div><p className="font-medium capitalize">{sub.plan || "Unknown plan"} · {sub.status}</p>
          {sub.currentPeriodEnd && <p className="text-sm text-slate-400">{sub.cancelAtPeriodEnd ? "Ends" : "Period ends"} {new Date(sub.currentPeriodEnd * 1000).toLocaleDateString("en-GB")}</p>}</div>
          <button type="button" disabled={busy !== null} onClick={() => void portal(sub.id)} className="rounded-lg border border-indigo-400 px-4 py-2 text-sm text-indigo-300 disabled:opacity-50">Manage billing</button>
        </div>)}
      </section>
      {error && <p role="alert" className="mt-5 rounded-lg border border-rose-400/30 p-4 text-sm text-rose-200">{error}</p>}
      <footer className="mt-12 border-t border-slate-800 pt-6 text-sm text-slate-400">McpOS is a trading brand of VORLEN LTD. Company no. 17387520.</footer>
    </div>
  </main>;
}
