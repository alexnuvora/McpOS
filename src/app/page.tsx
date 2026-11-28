"use client";
import DailyUsage from "@/components/daily-usage";

import { useCallback, useEffect, useState } from "react";
import {
  Activity, Bot, Braces, CheckCircle2, CircleDot, Command, LogOut, Mail,
  LayoutDashboard, Monitor, MousePointer2, Plus, RefreshCw, ShieldCheck,
  Smartphone, XCircle,
} from "lucide-react";

type Device = {
  id: string;
  device_name: string;
  platform: string;
  status: "online" | "offline" | "revoked";
  last_seen_at: string | null;
  paired_at: string;
};
type AuthStatus = { authenticated: boolean; user: { email: string } | null };
type BetaRelease = { available: boolean; version?: string; tag?: string; assets?: Array<{ name: string; url: string; size: number }>; error?: string };
type PairingCode = { code: string; expires_at: string; device_name: string };

const capabilities = [
  ["Desktop companion","Pair a Windows computer and manage active sessions.",Monitor,"Available"],
  ["Screen understanding","Let AI inspect your screen and accessible app controls.",Monitor,"Permission gated"],
  ["Computer control","Permissioned mouse, keyboard and application actions.",MousePointer2,"Permission gated"],
  ["Browser automation","Operate a separate browser profile with local consent. External sites may limit automation.",Activity,"Beta · permission gated"],
  ["MCP gateway","Connect authorised AI clients to paired desktop devices.",Braces,"Available in beta"],
  ["Permissions & audit","Approve actions, revoke access and review activity.",ShieldCheck,"Available"],
] as const;

export default function Home() {
  const [auth, setAuth] = useState<AuthStatus>({ authenticated: false, user: null });
  const [devices, setDevices] = useState<Device[]>([]);
  const [clientCount, setClientCount] = useState(0);
  const [deviceName, setDeviceName] = useState("Windows PC");
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [release, setRelease] = useState<BetaRelease | null>(null);

  const loadDevices = useCallback(async () => {
    const response = await fetch("/api/devices", { cache: "no-store" });
    if (!response.ok) throw new Error((await response.json()).error ?? "Could not load devices.");
    const data = await response.json() as { devices: Device[] };
    setDevices(data.devices);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      const data = await response.json() as AuthStatus;
      setAuth(data);
      if (data.authenticated) {
        await loadDevices();
        const clientsResponse = await fetch("/api/mcp/clients", { cache: "no-store" });
        if (clientsResponse.ok) {
          const clientData = await clientsResponse.json() as { clients: Array<{ revoked_at: string | null }> };
          setClientCount(clientData.clients.filter(client => !client.revoked_at).length);
        }
      } else { setDevices([]); setClientCount(0); }
    } catch {
      setMessage("Could not reach the McpOS account service.");
    } finally {
      setLoading(false);
    }
  }, [loadDevices]);

  useEffect(() => { const initial = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(initial); }, [refresh]);

  useEffect(() => {
    if (!auth.authenticated) return;
    const timer = window.setInterval(() => { void loadDevices().catch(() => setMessage("Could not refresh device status.")); }, 20000);
    return () => window.clearInterval(timer);
  }, [auth.authenticated, loadDevices]);

  useEffect(() => {
    if (!auth.authenticated) return;
    let active = true;
    const check = async () => {
      try {
        const result = await fetch("/api/desktop-release", {cache:"no-store"});
        const data = await result.json() as BetaRelease;
        if (active) setRelease(data);
      } catch { if (active) setRelease({available:false,error:"Release check unavailable."}); }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [auth.authenticated]);

  async function createPairingCode() {
    setBusy(true); setMessage(""); setPairing(null);
    try {
      const response = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_name: deviceName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create pairing code.");
      setPairing(data as PairingCode);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create pairing code.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeDevice(deviceId: string) {
    if (!window.confirm("Revoke this device? It will immediately lose its connection to McpOS.")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/devices/${deviceId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not revoke device.");
      await loadDevices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not revoke device.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!pairing) return;
    try { await navigator.clipboard.writeText(pairing.code); setMessage("Pairing code copied."); }
    catch { setMessage("Select and copy the pairing code manually."); }
  }

  const onlineDevices = devices.filter(device => device.status === "online").length;
  const activeDevices = devices.filter(device => device.status !== "revoked").length;

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    setAuth({ authenticated: false, user: null });
    setDevices([]);
    setPairing(null);
  }

  return <div className="workspace-grid">
    <aside className="sidebar flex flex-col p-4">
      <div className="mb-8 flex items-center gap-3 px-2 pt-1"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><Command size={19}/></div><div><div className="text-sm font-semibold">McpOS</div><div className="text-[11px] text-slate-500">AI desktop agent platform</div></div></div>
      <div className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Workspace</div>
      <nav className="space-y-1"><a href="#overview" className="nav-item active"><LayoutDashboard size={16}/>Overview</a><a href="#devices" className="nav-item"><Monitor size={16}/>Devices<span className="ml-auto pill">{activeDevices}</span></a>{auth.authenticated && <a href="#downloads" className="nav-item"><Monitor size={16}/>Windows downloads</a>}<a href="#activity" className="nav-item"><Activity size={16}/>Activity</a><a href="#capabilities" className="nav-item"><Braces size={16}/>Capabilities</a></nav>
      <div className="mb-3 mt-8 px-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Platform</div>
      <nav className="space-y-1"><a href="#capabilities" className="nav-item"><ShieldCheck size={16}/>Permissions</a><a href="/audit" className="nav-item"><Activity size={16}/>Audit history</a><a href="/integrations" className="nav-item"><Braces size={16}/>AI connections</a><a href="/billing" className="nav-item"><CircleDot size={16}/>Billing &amp; usage</a></nav>
      <div className="panel-soft mt-auto p-3"><div className="mb-2 flex items-center gap-2 text-xs font-medium"><ShieldCheck size={14} className="text-emerald-400"/>Permission-first access</div><p className="text-[11px] leading-5 text-slate-500">Pairing creates device identity only. Screen, accessibility, mouse, keyboard and file permissions remain disabled until separately approved.</p></div>
      <div className="mt-4 px-2 text-xs text-slate-500">Private workspace · v0.2</div>
    </aside>
    <main id="overview" className="min-w-0">
      <header className="flex min-h-[65px] items-center justify-between gap-3 border-b border-[#252d3a] px-5 sm:px-8"><div className="text-xs text-slate-500">Workspace <span className="mx-2">/</span><span className="text-slate-200">Overview</span></div><div className="flex items-center gap-3">{auth.authenticated ? <><span className="text-xs text-slate-300">{auth.user?.email}</span><button onClick={() => void signOut()} className="flex items-center gap-1.5 rounded-lg border border-[#30394a] px-3 py-2 text-xs text-slate-300 hover:text-white"><LogOut size={13}/>Sign out</button></> : <a href="/login" className="rounded-lg border border-[#30394a] px-3 py-2 text-xs text-slate-200 hover:bg-[#171e2a]">Sign in</a>}<button onClick={() => void refresh()} className="rounded-lg border border-[#30394a] p-2 text-slate-400 hover:text-white" aria-label="Refresh"><RefreshCw size={15}/></button></div></header>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-8">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 flex items-center gap-2 text-xs text-indigo-300"><CircleDot size={13}/>YOUR AI DESKTOP CONTROL CENTRE</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your AI, at your desktop.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Connect AI to your Windows desktop, apps, browser and approved files — with you in control.</p></div><a href="#devices" className="flex items-center gap-2 self-start rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-400"><Plus size={15}/>Pair a device</a></div>

        <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[[ "Paired devices", String(activeDevices), "Registered Windows companions", Monitor ],[ "Online devices", String(onlineDevices), "Heartbeat seen in the last 90 seconds", Activity ],[ "AI clients", String(clientCount), "Active remote MCP credentials", Braces ],[ "Desktop permissions", "Local", "Check current permission switches in the Windows companion", ShieldCheck ]].map(([name,value,note,Icon])=>{const I=Icon as typeof Mail;return <div className="panel p-4" key={String(name)}><div className="flex items-center justify-between text-xs text-slate-400"><span>{String(name)}</span><I size={16}/></div><div className="mt-3 text-2xl font-semibold">{String(value)}</div><div className="mt-1 text-[11px] text-slate-500">{String(note)}</div></div>})}
        </div>

        {auth.authenticated && <div className="mb-8"><DailyUsage/></div>}
        {auth.authenticated && <section id="downloads" className="panel mb-8 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Windows companion downloads</h2><span className="pill">Closed beta · unsigned</span></div>
          <p className="mt-2 text-xs leading-5 text-slate-400">For authorised testers only. Windows may block these unsigned installers. Do not disable Windows security protections. Verify the downloaded installer against SHA256SUMS.txt. This checks integrity, not publisher trust.</p>
          {release?.available ? <><p className="mt-3 text-xs text-slate-300">Available version {release.version} ({release.tag}). Compare with your installed version; updates are manual.</p><div className="mt-3 flex flex-wrap gap-2">{release.assets?.map(asset => <a key={asset.name} href={asset.url} className="rounded-lg border border-[#30394a] px-3 py-2 text-xs text-indigo-200 hover:bg-[#171e2a]">{asset.name.endsWith(".exe") ? "Download EXE" : asset.name.endsWith(".msi") ? "Download MSI" : "SHA-256 checksums"}</a>)}</div></> : <p className="mt-3 text-xs text-slate-500">{release?.error ?? (release ? "Beta installers are not published yet." : "Checking release availability…")}</p>}
        </section>}

        <section id="devices" className="panel mb-8 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-semibold">Windows devices</div><p className="mt-1 text-xs text-slate-500">Create a short-lived code here, then enter it in the McpOS Windows companion.</p></div><span className="pill">{devices.length} registered</span></div>
          {!auth.authenticated ? <div className="rounded-lg border border-dashed border-[#354052] p-5 text-center"><Mail className="mx-auto mb-2 text-slate-400" size={22}/><div className="text-sm font-medium">Sign in to manage your devices</div><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">Use your authorised email address to access your private McpOS workspace. We’ll send a one-time sign-in link; no GitHub App is needed.</p><a href="/login" className="mt-4 inline-flex rounded-lg bg-indigo-500 px-4 py-2 text-xs font-medium text-white">Sign in with email</a></div> :
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.8fr)]">
              <div>
                <div className="mb-3 text-xs font-medium text-slate-300">Your paired computers</div>
                {loading ? <p className="text-xs text-slate-500">Loading devices…</p> : devices.length === 0 ? <div className="rounded-lg border border-dashed border-[#30394a] p-5 text-center text-xs text-slate-500"><Monitor className="mx-auto mb-2" size={22}/>No devices paired yet.</div> :
                  <div className="space-y-2">{devices.map(device=><div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#252d3a] bg-[#0d121b] p-3"><div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-[#1a2230] p-2 text-slate-300"><Smartphone size={17}/></div><div className="min-w-0"><div className="truncate text-sm font-medium">{device.device_name}</div><div className="mt-1 text-[11px] text-slate-500">Paired {new Date(device.paired_at).toLocaleString()}</div></div></div><div className="flex items-center gap-3"><span className={device.status==="online"?"text-xs text-emerald-300":device.status==="revoked"?"text-xs text-rose-300":"text-xs text-slate-500"}>{device.status==="online"?"● Online":device.status==="revoked"?"Revoked":"○ Offline"}</span>{device.status!=="revoked"&&<button disabled={busy} onClick={()=>void revokeDevice(device.id)} className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-40">Revoke</button>}</div></div>)}</div>}
              </div>
              <div className="rounded-lg border border-[#252d3a] bg-[#0d121b] p-4">
                <div className="mb-3 text-xs font-medium text-slate-300">Pair a new Windows PC</div>
                <label className="mb-1 block text-[11px] text-slate-500" htmlFor="device-name">Device name</label>
                <input id="device-name" value={deviceName} onChange={event=>setDeviceName(event.target.value)} maxLength={120} className="mb-3 w-full rounded-lg border border-[#30394a] bg-[#111722] px-3 py-2 text-sm outline-none focus:border-indigo-400"/>
                <button disabled={busy||!deviceName.trim()} onClick={()=>void createPairingCode()} className="w-full rounded-lg bg-indigo-500 px-3 py-2.5 text-xs font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50">{busy?"Please wait…":"Generate pairing code"}</button>
                {pairing&&<div className="mt-4 rounded-lg border border-indigo-400/30 bg-indigo-500/10 p-3"><div className="text-[11px] text-indigo-200">Enter this code in McpOS Desktop</div><div className="my-2 flex items-center justify-between gap-2"><code className="text-xl font-bold tracking-[.18em] text-white">{pairing.code}</code><button onClick={()=>void copyCode()} className="rounded-md border border-indigo-300/30 px-2 py-1 text-[11px] text-indigo-100">Copy</button></div><div className="text-[11px] text-slate-400">Expires {new Date(pairing.expires_at).toLocaleTimeString()} · One use only</div></div>}
              </div>
            </div>}
          {message&&<div className="mt-3 flex items-center gap-2 text-xs text-amber-300"><XCircle size={14}/>{message}</div>}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.8fr)]">
          <section><div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Getting started</div><div className="panel divide-y divide-[#252d3a]">{[["Pair the Windows companion","Generate a one-time code above and enter it in the desktop app.",Monitor],["Choose desktop permissions","Pairing grants identity only. Approve screen, accessibility, input and file permissions separately.",ShieldCheck],["Connect an AI client","Open AI connections to authorise a supported MCP client; review its scopes before granting desktop access.",Bot]].map(([title,description,Icon],i)=>{const I=Icon as typeof Mail;return <div key={String(title)} className="flex gap-4 p-4 sm:p-5"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1a2230] text-slate-300"><I size={17}/></div><div><div className="text-sm font-medium">{i+1}. {String(title)}</div><p className="mt-1 text-xs leading-5 text-slate-500">{String(description)}</p></div></div>})}</div></section>
          <section id="activity"><div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Platform status</div><div className="panel p-4"><div className="mb-4 flex items-center justify-between"><div className="text-sm font-medium">Core services</div><span className="pill">Closed beta</span></div>{["Web workspace","One-time device pairing","Device credential heartbeat","MCP desktop relay","Screen and input tools"].map((item,i)=><div key={item} className="flex items-center justify-between border-t border-[#252d3a] py-3 text-xs"><span className="text-slate-400">{item}</span><span className={i<3?"flex items-center gap-1.5 text-emerald-300":"flex items-center gap-1.5 text-slate-500"}>{i<3?<CheckCircle2 size={13}/>:<CircleDot size={13}/>} {i<3?"Implemented":"Beta available"}</span></div>)}</div><div className="panel mt-4 p-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><ShieldCheck size={15} className="text-emerald-300"/>Safety by default</div><p className="text-xs leading-5 text-slate-500">Device credentials are random, stored hashed in Supabase and returned only once. Revocation invalidates the credential. Pairing alone does not grant desktop permissions. Review and revoke them in the Windows companion.</p></div></section>
        </div>
        <section id="capabilities" className="mt-8"><div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Workspace capabilities</div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{capabilities.map(([title,description,Icon,state])=><div className="panel p-4" key={title}><div className="mb-3 flex items-center justify-between"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a2230] text-indigo-300"><Icon size={16}/></div><span className="pill">{state}</span></div><div className="text-sm font-medium">{title}</div><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>)}</div></section>
        <footer className="mt-10 flex flex-col justify-between gap-2 border-t border-[#252d3a] pt-5 text-[11px] text-slate-600 sm:flex-row"><span>McpOS · AI Desktop Agent</span><span>Device pairing · heartbeat · revocation</span></footer>
      </div>
    </main>
  </div>;
}
