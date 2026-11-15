import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">M</span><div><strong>McpOS</strong><small>Desktop companion</small></div></div>
        <span className="status"><i /> Local app ready</span>
      </header>
      <section className="hero">
        <div className="eyebrow">WINDOWS COMPANION · EARLY ACCESS BUILD</div>
        <h1>Your AI, with permission to act.</h1>
        <p>McpOS will connect approved AI clients to your desktop, apps and browser. You stay in control of every capability.</p>
        <div className="notice"><span className="lock">⌑</span><div><strong>Nothing is being shared</strong><small>This starter build does not capture your screen, control input, read files or connect to a remote gateway.</small></div></div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><strong>Desktop capabilities</strong><small>Each capability will be enabled separately by you.</small></div><span className="tag">NOT CONNECTED</span></div>
        <div className="capability"><span className="symbol">▧</span><div><strong>Screen observation</strong><small>Consent-based screen capture and accessibility information.</small></div><span className="disabled">Coming next</span></div>
        <div className="capability"><span className="symbol">⌖</span><div><strong>Mouse & keyboard</strong><small>Bounded computer-use actions with visible session status.</small></div><span className="disabled">Coming later</span></div>
        <div className="capability"><span className="symbol">▣</span><div><strong>Browser & applications</strong><small>Approved browser profile and explicitly allowed apps.</small></div><span className="disabled">Planned</span></div>
        <div className="capability"><span className="symbol">▤</span><div><strong>Local files</strong><small>Only folders you explicitly choose to share.</small></div><span className="disabled">Planned</span></div>
      </section>
      <footer>Local-first by design <span>·</span> No background access <span>·</span> You can pause or revoke access</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
