"use client";

import { useMemo, useState } from "react";

type Product = "trading.paper.ema" | "vm.small" | "storage.small";
type Simulation = { stackId: string; quote: { expectedChargeUsd: number; authorizationCapUsd: number; estimatedGcpUsd: number; durationMinutes: number }; mandate: { requestHash: string; expiresAt: string }; onramp: { qrPayload: string }; resources: Array<{ service: string; region: string; action: string; estimatedUsd: number }>; timeline: Array<{ state: string; detail: string }>; warning: string };

const copy = { "trading.paper.ema": "BTC paper-trading stack", "vm.small": "Temporary VM", "storage.small": "Temporary storage" } as const;

export default function V3DemoPage() {
  const [productId, setProductId] = useState<Product>("trading.paper.ema");
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [payer, setPayer] = useState("0x0000000000000000000000000000000000000000");
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [error, setError] = useState("");
  const qr = useMemo(() => simulation?.onramp.qrPayload.replace("coinbase-sandbox://", "") ?? "Awaiting preview", [simulation]);

  async function preview() {
    setError(""); setSimulation(null);
    const response = await fetch("/api/v3/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productId, durationMinutes, payer }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to create preview."); return; }
    setSimulation(data);
  }

  return <main className="shell">
    <header><span className="badge">V3 SANDBOX</span><h1>Cloud deployment checkout</h1><p>Coinbase-style funding and AP2-derived authorization, rehearsed safely. <strong>No payment or resource creation is enabled.</strong></p></header>
    <section className="notice">Simulation — no money transferred, no card form, no KYC collection, no Cloud Run/VM/storage resource, and no Hyperliquid order.</section>
    <section className="grid">
      <article className="card"><h2>1. Choose a temporary stack</h2><label>Product<select value={productId} onChange={(e) => setProductId(e.target.value as Product)}>{Object.entries(copy).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Duration<select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>{[15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label><label>Demo wallet / payer<input value={payer} onChange={(e) => setPayer(e.target.value)} spellCheck={false} /></label><button onClick={preview}>Preview protected checkout</button>{error && <p className="error">{error}</p>}</article>
      <article className="card"><h2>2. Funding handoff</h2><div className="qr">▣<br/><small>{qr}</small></div><p>Coinbase sandbox QR handoff. A future production flow can offer embedded wallet + Apple Pay where supported; identity verification is provider and jurisdiction dependent.</p><div className="status"><b>Wallet</b><span>Simulation only</span></div><div className="status"><b>Verification</b><span>Not checked</span></div></article>
    </section>
    {simulation && <section className="result">
      <div className="card"><h2>3. AP2-derived deployment mandate</h2><p><b>Authorization ceiling</b> ${simulation.quote.authorizationCapUsd.toFixed(2)} USDC &nbsp; <b>Expected settlement</b> ${simulation.quote.expectedChargeUsd.toFixed(2)} only after success.</p><p className="muted">GCP allocation: ${simulation.quote.estimatedGcpUsd.toFixed(3)} · expires {new Date(simulation.mandate.expiresAt).toLocaleTimeString()} · request hash {simulation.mandate.requestHash.slice(0, 16)}…</p><p>No unused authorization is transferred. This is a deterministic beta mandate, not a production AP2 Trusted-Surface signature.</p></div>
      <div className="card"><h2>4. What would be deployed</h2><table><thead><tr><th>Service</th><th>Region</th><th>Role</th><th>Estimate</th></tr></thead><tbody>{simulation.resources.map((r) => <tr key={r.service}><td>{r.service}</td><td>{r.region}</td><td>{r.action}</td><td>${r.estimatedUsd.toFixed(3)}</td></tr>)}</tbody></table></div>
      <div className="card"><h2>5. Lifecycle preview</h2>{simulation.timeline.map((event) => <p key={event.state}><b>{event.state.replaceAll("_", " ")}</b><br/><span className="muted">{event.detail}</span></p>)}<p className="warning">{simulation.warning}</p></div>
    </section>}
    <style jsx>{`
      :global(body){margin:0;background:#07111d;color:#e8f0fa;font-family:Inter,system-ui,sans-serif}.shell{max-width:1100px;margin:auto;padding:36px 20px 70px}.badge{font-size:12px;letter-spacing:.12em;color:#63d8e8;font-weight:800}h1{font-size:36px;margin:8px 0}h2{font-size:17px;margin-top:0}.notice,.card{border:1px solid #24435d;background:#0d1b2a;border-radius:12px;padding:18px}.notice{border-color:#7c5d20;background:#241b0e;color:#f6d893;margin:22px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.result{display:grid;gap:14px;margin-top:14px}label{display:grid;gap:7px;margin:13px 0;color:#afc0d1;font-size:13px}input,select{background:#07111d;border:1px solid #34536e;border-radius:7px;color:#e8f0fa;padding:10px;font:inherit}button{background:#2e83d8;border:0;color:white;border-radius:7px;padding:11px 14px;font-weight:750;cursor:pointer;margin-top:8px}.qr{background:white;color:#07111d;border-radius:8px;padding:18px;text-align:center;font-size:45px;word-break:break-all}.qr small{font-size:10px}.status{display:flex;justify-content:space-between;border-top:1px solid #24435d;padding:9px 0}.muted{color:#9db0c3;font-size:13px}.warning{color:#f6d893}.error{color:#ff99a8}table{width:100%;border-collapse:collapse}th,td{padding:9px;text-align:left;border-bottom:1px solid #24435d;font-size:13px}@media(max-width:700px){.grid{grid-template-columns:1fr}h1{font-size:29px}}
    `}</style>
  </main>;
}
