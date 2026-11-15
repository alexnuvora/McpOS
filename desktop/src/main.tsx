import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">M</span><div><strong>McpOS</strong><small>Windows desktop companion</small></div></div>
        <span className="status"><i className="offline" /> Disconnected</span>
      </header>
      <section className="hero">
        <div className="eyebrow">WINDOWS COMPANION · LOCAL SESSION</div>
        <h1>Your AI, with permission to act.</h1>
        <p>McpOS will connect approved AI clients to your desktop, apps and browser. You stay in control of every capability.</p>
        <div className="notice"><span className="lock">⌑</span><div><strong>Desktop access is paused</strong><small>No screen, accessibility, mouse or keyboard data is being shared. Close hides McpOS to the Windows system tray; use the tray menu to reopen or quit.</small></div></div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><strong>Desktop capabilities</strong><small>Nothing is enabled until you explicitly grant permission.</small></div><span className="tag">DISCONNECTED</span></div>
        <div className="capability"><span className="symbol">▧</span><div><strong>Screen observation</strong><small>Consent-based screen capture. A visible session indicator will remain on while active.</small></div><span className="disabled">Not enabled</span></div>
        <div className="capability"><span className="symbol">⌖</span><div><strong>Windows accessibility</strong><small>Read accessible control names, roles and states from the foreground application.</small></div><span className="disabled">Not enabled</span></div>
        <div className="capability"><span className="symbol">⌘</span><div><strong>Mouse & keyboard</strong><small>Bounded actions only, with a local emergency pause control.</small></div><span className="disabled">Not enabled</span></div>
        <div className="capability"><span className="symbol">⇄</span><div><strong>Secure device connection</strong><small>Pairing and remote AI relay will be enabled only after account identity and device credentials are established.</small></div><span className="disabled">Not paired</span></div>
      </section>
      <footer>Local-first by design <span>·</span> Visible tray presence <span>·</span> Close to tray, not background control</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
