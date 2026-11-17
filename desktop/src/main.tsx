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
  const [captureApproved, setCaptureApproved] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [screenImage, setScreenImage] = useState("");
  const [accessibilityApproved, setAccessibilityApproved] = useState(false);
  const [pointerApproved, setPointerApproved] = useState(false);
  const [keyboardApproved, setKeyboardApproved] = useState(false);
  const [targetApp, setTargetApp] = useState("");
  const [accessibilityTree, setAccessibilityTree] = useState("");

  async function refreshStatus() {
    try { setStatus(await invoke<DeviceStatus>("get_device_status")); }
    catch { setError("Could not read the local device credential."); }
  }

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refreshStatus();
      void invoke<boolean>("get_screen_capture_approval").then(setCaptureApproved).catch(() => setCaptureApproved(false));
      void invoke<boolean>("get_accessibility_approval").then(setAccessibilityApproved).catch(() => setAccessibilityApproved(false));
      void invoke<boolean>("get_pointer_approval").then(setPointerApproved).catch(() => setPointerApproved(false));
      void invoke<boolean>("get_keyboard_approval").then(setKeyboardApproved).catch(() => setKeyboardApproved(false));
    }, 0);
    const timer = window.setInterval(() => void refreshStatus(), 15000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, []);



  async function updatePermission(capability: "accessibility" | "pointer" | "keyboard", approved: boolean) {
    setCaptureBusy(true); setError("");
    const commands = {
      accessibility: { invoke: "set_accessibility_approval", set: setAccessibilityApproved },
      pointer: { invoke: "set_pointer_approval", set: setPointerApproved },
      keyboard: { invoke: "set_keyboard_approval", set: setKeyboardApproved },
    } as const;
    try {
      await invoke(commands[capability].invoke, { approved });
      commands[capability].set(approved);
      setMessage(approved ? capability + " permission approved on this computer." : capability + " permission disabled.");
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Could not update the permission.");
    } finally { setCaptureBusy(false); }
  }

  async function inspectApp() {
    if (!targetApp.trim()) { setError("Enter an application name or process reference first."); return; }
    setCaptureBusy(true); setError(""); setAccessibilityTree("");
    try {
      setAccessibilityTree(await invoke<string>("inspect_application", { appName: targetApp.trim() }));
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Could not inspect the application.");
    } finally { setCaptureBusy(false); }
  }

  async function updateCaptureApproval(approved: boolean) {
    setCaptureBusy(true); setError("");
    try {
      await invoke("set_screen_capture_approval", { approved });
      setCaptureApproved(approved);
      if (!approved) setScreenImage("");
      setMessage(approved ? "Screen capture permission enabled on this computer. Captures remain local to this app." : "Screen capture permission disabled.");
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Could not update screen-capture permission.");
    } finally { setCaptureBusy(false); }
  }

  async function captureScreen() {
    setCaptureBusy(true); setError(""); setMessage("");
    try {
      const image = await invoke<string>("capture_screen");
      setScreenImage(image);
      setMessage("Screen captured locally. It has not been uploaded or shared.");
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Screen capture failed.");
    } finally { setCaptureBusy(false); }
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
      <div className="capability"><span className="symbol">▧</span><div><strong>Screen observation</strong><small>{captureApproved ? "Approved on this computer. Captures are local and are not transmitted." : "Off by default. Enable only when you want this computer to capture its primary display."}</small></div><span className={captureApproved ? "enabled" : "disabled"}>{captureApproved ? "Approved" : "Off"}</span></div>
      <div className="permission-actions">
        <button className="secondary" disabled={captureBusy} onClick={() => void updateCaptureApproval(!captureApproved)}>{captureBusy ? "Please wait…" : captureApproved ? "Disable screen capture" : "Approve screen capture"}</button>
        <button disabled={!captureApproved || captureBusy} onClick={() => void captureScreen()}>{captureBusy ? "Working…" : "Capture screen"}</button>
      </div>
      {screenImage && <div className="screen-preview"><img src={screenImage} alt="Locally captured primary display" /><small>Local preview · not shared with an AI client</small></div>}
      <div className="capability"><span className="symbol">⌖</span><div><strong>Windows accessibility</strong><small>{accessibilityApproved ? "Approved locally. You can inspect an application tree in this desktop app." : "Off by default. No application controls are read."}</small></div><span className={accessibilityApproved ? "enabled" : "disabled"}>{accessibilityApproved ? "Approved" : "Off"}</span></div>
      <div className="permission-actions"><button className="secondary" disabled={captureBusy} onClick={() => void updatePermission("accessibility", !accessibilityApproved)}>{accessibilityApproved ? "Disable accessibility" : "Approve accessibility"}</button></div>
      {accessibilityApproved && <div className="local-inspector"><label htmlFor="target-app">Application name or process reference</label><div className="inspector-row"><input id="target-app" value={targetApp} onChange={event => setTargetApp(event.target.value)} placeholder="e.g. notepad or pid:1234" /><button disabled={captureBusy || !targetApp.trim()} onClick={() => void inspectApp()}>{captureBusy ? "Inspecting…" : "Inspect app"}</button></div>{accessibilityTree && <pre className="tree-preview">{accessibilityTree}</pre>}</div>}
      <div className="capability"><span className="symbol">⌘</span><div><strong>Mouse control</strong><small>{pointerApproved ? "Locally approved. Remote relay is not connected." : "Off by default. No pointer actions can run."}</small></div><span className={pointerApproved ? "enabled" : "disabled"}>{pointerApproved ? "Approved" : "Off"}</span></div>
      <div className="permission-actions"><button className="secondary" disabled={captureBusy} onClick={() => void updatePermission("pointer", !pointerApproved)}>{pointerApproved ? "Disable mouse control" : "Approve mouse control"}</button></div>
      <div className="capability"><span className="symbol">⌨</span><div><strong>Keyboard control</strong><small>{keyboardApproved ? "Locally approved. Remote relay is not connected." : "Off by default. No text or key input can run."}</small></div><span className={keyboardApproved ? "enabled" : "disabled"}>{keyboardApproved ? "Approved" : "Off"}</span></div>
      <div className="permission-actions"><button className="secondary" disabled={captureBusy} onClick={() => void updatePermission("keyboard", !keyboardApproved)}>{keyboardApproved ? "Disable keyboard control" : "Approve keyboard control"}</button></div>
      <p className="hint">These approvals are stored on this PC. They do not yet enable remote AI control; the authenticated relay and per-action approval workflow are still being built.</p>
      {error && <div className="feedback error">{error}</div>}
      {message && <div className="feedback success">{message}</div>}
    </section>}
    <footer>Local-first by design <span>·</span> Windows Credential Manager <span>·</span> Permissions default off</footer>
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
