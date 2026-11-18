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
  const [screenConsent, setScreenConsent] = useState(false);
  const [accessibilityConsent, setAccessibilityConsent] = useState(false);
  const [approvedFolders, setApprovedFolders] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function refreshStatus() {
    try {
      setStatus(await invoke<DeviceStatus>("get_device_status"));
      setScreenConsent(await invoke<boolean>("get_screen_capture_consent"));
      setAccessibilityConsent(await invoke<boolean>("get_accessibility_consent"));
      setApprovedFolders(await invoke<string[]>("get_approved_folders"));
    }
    catch { setError("Could not read the local device credential."); }
  }

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshStatus(), 0);
    const timer = window.setInterval(() => void refreshStatus(), 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, []);

  async function toggleScreenConsent(enabled: boolean) {
    setError(""); setMessage("");
    try {
      const actual = await invoke<boolean>("set_screen_capture_consent", { enabled });
      setScreenConsent(actual);
      setMessage(actual ? "Screen capture is enabled locally. AI requests still require a separately scoped client key." : "Screen capture has been disabled on this computer.");
    } catch {
      setError("Could not update the local screen-capture consent setting.");
    }
  }

  async function toggleAccessibilityConsent(enabled: boolean) {
    setError(""); setMessage("");
    try {
      const actual = await invoke<boolean>("set_accessibility_consent", { enabled });
      setAccessibilityConsent(actual);
      setMessage(actual ? "Windows accessibility understanding is enabled locally. Only a bounded list of top-level app windows is exposed." : "Windows accessibility understanding has been disabled on this computer.");
    } catch {
      setError("Could not update the local Windows accessibility setting.");
    }
  }

  async function addApprovedFolder() {
    setError(""); setMessage("");
    try {
      const folders = await invoke<string[]>("pick_approved_folder");
      setApprovedFolders(folders);
      setMessage("Folder approval updated. Only these folders can be read by a separately scoped AI client.");
    } catch { setError("Could not add the selected folder."); }
  }

  async function removeApprovedFolder(path: string) {
    setError(""); setMessage("");
    try {
      setApprovedFolders(await invoke<string[]>("remove_approved_folder", { path }));
      setMessage("Folder access revoked locally.");
    } catch { setError("Could not revoke folder access."); }
  }

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
      <div className="capability consent-capability"><span className="symbol">▧</span><div><strong>Screen capture consent</strong><small>This is a local Windows switch. It resets to off when McpOS restarts. Turn it off at any time to stop further captures.</small></div><button className={"consent-switch " + (screenConsent ? "is-on" : "")} role="switch" aria-checked={screenConsent} aria-label="Allow screen capture on this computer" onClick={() => void toggleScreenConsent(!screenConsent)}><span /></button></div>
      <div className="capability consent-capability"><span className="symbol">⌖</span><div><strong>Application understanding</strong><small>Read-only Windows UI Automation. Shares a limited list of top-level window names and process IDs, not control text or keystrokes. Local consent resets to off on restart.</small></div><button className={"consent-switch " + (accessibilityConsent ? "is-on" : "")} role="switch" aria-checked={accessibilityConsent} aria-label="Allow Windows accessibility inspection" onClick={() => void toggleAccessibilityConsent(!accessibilityConsent)}><span /></button></div>
      <div className="capability"><span className="symbol">⌘</span><div><strong>Mouse & keyboard</strong><small>No remote input actions are enabled.</small></div><span className="disabled">Not enabled</span></div>
      <section className="approved-folders">
        <div className="folder-heading"><div><strong>Approved folders</strong><small>Only folders you select here are eligible for read-only AI access. This approval list resets when McpOS restarts.</small></div><button onClick={() => void addApprovedFolder()}>Choose folder</button></div>
        {approvedFolders.length === 0 ? <p className="folder-empty">No folders approved.</p> : approvedFolders.map(path => <div className="folder-row" key={path}><span title={path}>{path}</span><button onClick={() => void removeApprovedFolder(path)}>Remove</button></div>)}
      </section>
      {error && <div className="feedback error">{error}</div>}
      {message && <div className="feedback success">{message}</div>}
    </section>}
    <footer>Local-first by design <span>·</span> Windows Credential Manager <span>·</span> Permissions default off</footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
