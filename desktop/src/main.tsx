import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./style.css";

type DeviceStatus = { paired: boolean; connected: boolean; device_id: string | null };

function App() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<DeviceStatus>({ paired: false, connected: false, device_id: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refreshStatus() {
    try { setStatus(await invoke<DeviceStatus>("get_device_status")); }
    catch { setError("Could not read the local device credential."); }
  }

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshStatus(), 0);
    const timer = window.setInterval(() => void refreshStatus(), 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, []);

  async function pair() {
    setBusy(true); setError(""); setMessage("");
    try {
      const pairedName = await invoke<string>("pair_device", { code: code.trim() });
      setCode("");
      setMessage(pairedName + " has been paired. A secure heartbeat will keep its status updated.");
      await refreshStatus();
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Pairing failed. Check the code and try again.");
    } finally { setBusy(false); }
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">M</span><div><strong>McpOS</strong><small>Windows desktop companion</small></div></div>
      <span className="status"><i className={status.connected ? "online" : "offline"} /> {!status.paired ? "Not paired" : status.connected ? "Connected" : "Paired · Offline"}</span>
    </header>
    <section className="hero">
      <div className="eyebrow">WINDOWS COMPANION · LOCAL SESSION</div>
      <h1>Your AI, with permission to act.</h1>
      <p>Pair this computer with your McpOS workspace. Pairing establishes device identity only — it does not grant screen, accessibility, mouse, keyboard or file access.</p>
      <div className="notice"><span className="lock">⌑</span><div><strong>{status.paired ? "This computer has a device identity" : "Desktop access is not enabled"}</strong><small>{status.paired ? status.connected ? "Connected to McpOS. The companion sends a secure heartbeat every 30 seconds." : "The device is paired, but the heartbeat is currently offline. Check your internet connection." : "No desktop data or controls are shared until you separately approve a capability."}</small></div></div>
    </section>
    {!status.paired && <section className="panel pairing-panel">
      <div className="panel-heading"><div><strong>Pair this computer</strong><small>Generate a one-time code in your McpOS web dashboard.</small></div><span className="tag">5 MINUTE CODE</span></div>
      <label htmlFor="pairing-code">One-time pairing code</label>
      <input id="pairing-code" value={code} maxLength={12} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="10-character code" autoComplete="one-time-code"/>
      <button disabled={busy || code.replace(/[^A-Z0-9]/g, "").length !== 10} onClick={() => void pair()}>{busy ? "Pairing…" : "Securely pair this computer"}</button>
      {error && <div className="feedback error">{error}</div>}
      {message && <div className="feedback success">{message}</div>}
      <small className="hint">The code can be used once. The raw device credential is never displayed and is stored in Windows Credential Manager.</small>
    </section>}
    {status.paired && <section className="panel">
      <div className="panel-heading"><div><strong>Device connection</strong><small>Device ID: {status.device_id ?? "Registered"}</small></div><span className="tag">PAIRED</span></div>
      <div className="capability"><span className="symbol">✓</span><div><strong>Device identity</strong><small>Credential stored securely on this Windows computer.</small></div><span className="enabled">Paired</span></div>
      <div className="capability"><span className="symbol">↻</span><div><strong>Connection heartbeat</strong><small>The desktop companion sends a heartbeat every 30 seconds.</small></div><span className={status.connected ? "enabled" : "disabled"}>{status.connected ? "Connected" : "Offline"}</span></div>
      <div className="capability"><span className="symbol">▧</span><div><strong>Screen observation</strong><small>Screen capture remains disabled until a separate consent workflow is implemented.</small></div><span className="disabled">Not enabled</span></div>
      <div className="capability"><span className="symbol">⌖</span><div><strong>Windows accessibility</strong><small>Application controls are not being read or shared.</small></div><span className="disabled">Not enabled</span></div>
      <div className="capability"><span className="symbol">⌘</span><div><strong>Mouse & keyboard</strong><small>No remote input actions are enabled.</small></div><span className="disabled">Not enabled</span></div>
      {error && <div className="feedback error">{error}</div>}
      {message && <div className="feedback success">{message}</div>}
    </section>}
    <footer>Local-first by design <span>·</span> Windows Credential Manager <span>·</span> Permissions default off</footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
