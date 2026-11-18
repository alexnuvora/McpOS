import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./style.css";

type DeviceStatus = { paired: boolean; connected: boolean; device_id: string | null };
type PendingAction = { id: string; command: string; payload: Record<string, unknown> };
type AutomationPolicy = { mode: "manual" | "selected" | "all"; paused: boolean; expires_at: number | null; auto_pointer: boolean; auto_keyboard: boolean; auto_browser: boolean; auto_screen: boolean };

function App() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<DeviceStatus>({ paired: false, connected: false, device_id: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [screenConsent, setScreenConsent] = useState(false);
  const [accessibilityConsent, setAccessibilityConsent] = useState(false);
  const [browserConsent, setBrowserConsent] = useState(false);
  const [approvedFolders, setApprovedFolders] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [error, setError] = useState("");
  const [automation, setAutomation] = useState<AutomationPolicy>({ mode: "manual", paused: false, expires_at: null, auto_pointer: false, auto_keyboard: false, auto_browser: false, auto_screen: false });
  const [expiryMinutes, setExpiryMinutes] = useState(60);

  async function refreshStatus() {
    try {
      setStatus(await invoke<DeviceStatus>("get_device_status"));
      setScreenConsent(await invoke<boolean>("get_screen_capture_consent"));
      setAccessibilityConsent(await invoke<boolean>("get_accessibility_consent"));
      setBrowserConsent(await invoke<boolean>("get_browser_consent"));
      setApprovedFolders(await invoke<string[]>("get_approved_folders"));
      setAutomation(await invoke<AutomationPolicy>("get_automation_policy"));
    }
    catch { setError("Could not read the local device credential."); }
  }

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshStatus(), 0);
    const timer = window.setInterval(() => void refreshStatus(), 15000);
    const approvalTimer = window.setInterval(() => { void invoke<PendingAction | null>("get_pending_action").then(setPendingAction).catch(() => undefined); }, 1200);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.clearInterval(approvalTimer); };
  }, []);

  async function setAutomationMode(mode: "manual" | "selected" | "all") {
    setError(""); setMessage("");
    try {
      const policy = await invoke<AutomationPolicy>("set_automation_policy", {
        mode, expiryMinutes,
        autoPointer: mode === "all" || (mode === "selected" && automation.auto_pointer),
        autoKeyboard: mode === "all" || (mode === "selected" && automation.auto_keyboard),
        autoBrowser: mode === "all" || (mode === "selected" && automation.auto_browser),
        autoScreen: mode === "all" || (mode === "selected" && automation.auto_screen)
      });
      setAutomation(policy);
      setMessage(mode === "all" ? "AUTO mode enabled on this Windows computer. Destructive file actions remain blocked." : mode === "selected" ? "Selected-action automation enabled on this Windows computer." : "Manual approval mode enabled.");
    } catch (reason) { setError(typeof reason === "string" ? reason : "Could not update automation policy."); }
  }

  async function pauseAutomation() {
    setError(""); setMessage("");
    try {
      const policy = await invoke<AutomationPolicy>("pause_automation");
      setAutomation(policy);
      setPendingAction(null);
      setMessage("Automation paused locally. New actions are blocked until you resume a mode.");
    } catch (reason) { setError(typeof reason === "string" ? reason : "Could not pause automation."); }
  }

  async function toggleAutomationPermission(key: "auto_pointer" | "auto_keyboard" | "auto_browser" | "auto_screen", enabled: boolean) {
    const next = { ...automation, [key]: enabled };
    setAutomation(next);
    if (automation.mode === "selected" && !automation.paused) {
      try {
        const policy = await invoke<AutomationPolicy>("set_automation_policy", {
          mode: "selected", expiryMinutes,
          autoPointer: next.auto_pointer, autoKeyboard: next.auto_keyboard,
          autoBrowser: next.auto_browser, autoScreen: next.auto_screen
        });
        setAutomation(policy);
      } catch (reason) { setError(typeof reason === "string" ? reason : "Could not update selected permissions."); }
    }
  }

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

  async function approvePendingAction() {
    if (approvalBusy) return;
    setApprovalBusy(true); setError(""); setMessage("");
    try { setMessage(await invoke<string>("approve_pending_action")); setPendingAction(null); }
    catch (reason) { setError(typeof reason === "string" ? reason : "Could not execute the approved action."); setPendingAction(null); }
    finally { setApprovalBusy(false); }
  }

  async function denyPendingAction() {
    if (approvalBusy) return;
    setApprovalBusy(true); setError(""); setMessage("");
    try { setMessage(await invoke<string>("deny_pending_action")); setPendingAction(null); }
    catch (reason) { setError(typeof reason === "string" ? reason : "Could not deny the pending action."); }
    finally { setApprovalBusy(false); }
  }

  async function toggleBrowserConsent(enabled: boolean) {
    setError(""); setMessage("");
    try {
      const actual = await invoke<boolean>("set_browser_consent", { enabled });
      setBrowserConsent(actual);
      setMessage(actual ? "Isolated browser automation is enabled. The browser uses a separate profile; navigation and page actions still require local approval." : "Isolated browser access has been disabled on this computer.");
    } catch { setError("Could not update isolated browser consent."); }
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
      <div className="topbar-right">{automation.mode === "all" && !automation.paused && <span className="auto-indicator"><i /> AUTO</span>}<span className="status"><i className={status.connected ? "online" : "offline"} /> {!status.paired ? "Not paired" : status.connected ? "Connected" : "Paired · Offline"}</span></div>
    </header>
    <section className="hero">
      <div className="eyebrow">WINDOWS COMPANION · LOCAL SESSION</div>
      <h1>Your AI, with permission to act.</h1>
      <p>Pair this computer with your McpOS workspace. Pairing establishes device identity only — it does not grant screen, accessibility, browser, mouse, keyboard or file access.</p>
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
      <div className="capability consent-capability"><span className="symbol">◎</span><div><strong>Isolated browser automation</strong><small>Uses a separate WebView2 profile with separate cookies and storage. Only HTTPS sites are allowed; every navigation, click and text-entry action requires local approval.</small></div><button className={"consent-switch " + (browserConsent ? "is-on" : "")} role="switch" aria-checked={browserConsent} aria-label="Allow isolated browser automation" onClick={() => void toggleBrowserConsent(!browserConsent)}><span /></button></div>
      <section className="automation-panel">
        <div className="automation-title"><div><strong>Automation approval</strong><small>Choose how this Windows computer handles permitted AI actions. The setting is local and resets to Manual after restart.</small></div><span className={automation.mode === "all" && !automation.paused ? "auto-pill" : "manual-pill"}>{automation.paused ? "PAUSED" : automation.mode === "all" ? "AUTO" : automation.mode.toUpperCase()}</span></div>
        <div className="mode-row">
          <button className={automation.mode === "manual" ? "mode-choice selected" : "mode-choice"} onClick={() => void setAutomationMode("manual")}>Manual approval</button>
          <button className={automation.mode === "selected" ? "mode-choice selected" : "mode-choice"} onClick={() => void setAutomationMode("selected")}>Selected actions</button>
          <button className={automation.mode === "all" && !automation.paused ? "mode-choice selected auto-choice" : "mode-choice"} onClick={() => void setAutomationMode("all")}>Auto-approve all</button>
        </div>
        <div className="expiry-row"><label htmlFor="session-expiry">Session expiry</label><select id="session-expiry" value={expiryMinutes} onChange={event => setExpiryMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={60}>1 hour</option><option value={240}>4 hours</option><option value={480}>8 hours</option></select></div>
        {automation.mode === "selected" && <div className="permission-list">
          <label><input type="checkbox" checked={automation.auto_pointer} onChange={event => void toggleAutomationPermission("auto_pointer", event.target.checked)}/> Mouse clicks</label>
          <label><input type="checkbox" checked={automation.auto_keyboard} onChange={event => void toggleAutomationPermission("auto_keyboard", event.target.checked)}/> Keyboard text entry</label>
          <label><input type="checkbox" checked={automation.auto_browser} onChange={event => void toggleAutomationPermission("auto_browser", event.target.checked)}/> Browser navigation and interaction</label>
          <label><input type="checkbox" checked={automation.auto_screen} onChange={event => void toggleAutomationPermission("auto_screen", event.target.checked)}/> Screen captures</label>
        </div>}
        <div className="automation-warning">Auto mode only covers currently supported, non-destructive actions. File deletion, overwriting, terminal commands and application installation are not granted by this setting. Browser automation still requires its separate local switch.</div>
        <div className="automation-controls"><button className="pause-button" onClick={() => void pauseAutomation()}>Pause automation now</button><span>{automation.expires_at && !automation.paused ? "Expires " + new Date(automation.expires_at * 1000).toLocaleString() : "No active automation session"}</span></div>
      </section>
      <div className="capability"><span className="symbol">⌘</span><div><strong>Mouse & keyboard</strong><small>Pointer clicks and text entry follow the local approval policy. Destructive file operations remain unavailable.</small></div><span className={automation.mode === "all" && !automation.paused ? "enabled" : "disabled"}>{automation.paused ? "Paused" : automation.mode === "all" ? "AUTO" : "Policy controlled"}</span></div>
      {pendingAction && <section className="approval-card">
        <div className="approval-eyebrow">LOCAL APPROVAL REQUIRED</div>
        <strong>{pendingAction.command === "input.pointer.click" ? "AI wants to click your screen" : pendingAction.command === "input.keyboard.type" ? "AI wants to type on your computer" : pendingAction.command === "browser.open" ? "AI wants to open a website in the isolated browser" : pendingAction.command === "browser.click" ? "AI wants to click a page element" : "AI wants to type into a page field"}</strong>
        {pendingAction.command === "input.pointer.click" ? <p>Button: {String(pendingAction.payload.button ?? "left")} · Position: {String(pendingAction.payload.x)}, {String(pendingAction.payload.y)}</p> : pendingAction.command === "browser.open" ? <p className="approval-text">{String(pendingAction.payload.url ?? "")}</p> : pendingAction.command === "browser.click" ? <p className="approval-text">CSS selector: {String(pendingAction.payload.selector ?? "")}</p> : pendingAction.command === "browser.type" ? <p className="approval-text">Selector: {String(pendingAction.payload.selector ?? "")} · Text: “{String(pendingAction.payload.text ?? "")}”</p> : <p className="approval-text">Text to enter: “{String(pendingAction.payload.text ?? "")}”</p>}
        <div className="approval-actions"><button className="deny" disabled={approvalBusy} onClick={() => void denyPendingAction()}>{approvalBusy ? "Working…" : "Deny"}</button><button className="approve" disabled={approvalBusy} onClick={() => void approvePendingAction()}>{approvalBusy ? "Working…" : "Approve once"}</button></div>
        <small>Nothing happens unless you approve this exact action here. Each action requires a separate approval.</small>
      </section>}
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
