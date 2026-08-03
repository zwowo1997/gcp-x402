"use client";

import { useEffect, useState } from "react";

type Product = "trading.paper.ema" | "vm.small" | "storage.small";
type Action = "approve" | "fund" | "provision" | "stop" | "resume" | "shutdown" | "cancel";
type Simulation = {
  stackId: string; status: string; paymentStatus: string; createdAt: string; expiresAt: string;
  quote: { productId: Product; expectedChargeUsd: number; authorizationCapUsd: number; estimatedGcpUsd: number; durationMinutes: number };
  mandate: { requestHash: string; expiresAt: string; status: string };
  embeddedWallet: { address: string; state: string };
  onramp: { qrPayload: string; state: string; applePay: string; kyc: string };
  resources: Array<{ service: string; region: string; action: string; estimatedUsd: number }>;
  timeline: Array<{ state: string; detail: string; at: string }>;
  warning: string;
};

const labels = { "trading.paper.ema": "BTC paper-trading infrastructure", "vm.small": "Temporary VM", "storage.small": "Temporary storage" } as const;
const actionLabel: Record<Action, string> = { approve: "Approve with Apple Pay", fund: "Simulate wallet funding", provision: "Start simulated infrastructure", stop: "Stop strategy", resume: "Resume strategy", shutdown: "Shut down", cancel: "Cancel checkout" };
const allowed: Record<string, Action[]> = { checkout: ["approve", "cancel"], approved: ["fund", "cancel"], funded: ["provision", "cancel"], running: ["stop", "shutdown"], stopped: ["resume", "shutdown"] };

function sessionToken() { return new URLSearchParams(window.location.hash.slice(1)).get("session"); }

function SandboxHandoffVisual({ seed }: { seed: string }) {
  const cells = Array.from({ length: 225 }, (_, index) => ((seed.charCodeAt(index % Math.max(1, seed.length)) + index * 17) % 5) < 2);
  return <svg viewBox="0 0 15 15" role="img" aria-label="Non-scannable Coinbase sandbox handoff visual">{cells.map((dark, index) => dark ? <rect key={index} x={index % 15} y={Math.floor(index / 15)} width="1" height="1" fill="#07111d" /> : null)}</svg>;
}

export default function V3DemoPage() {
  const [productId, setProductId] = useState<Product>("trading.paper.ema");
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);

  async function request(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    const token = sessionToken(); if (token) headers.set("x-gcp-x402-session", token);
    const response = await fetch(url, { ...init, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) setLocked(true);
      throw new Error(body.error ?? "Request failed.");
    }
    return body as Simulation;
  }
  async function load(stackId: string) {
    try { setSimulation(await request(`/api/v3/simulations/${encodeURIComponent(stackId)}`)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load simulation."); }
  }
  useEffect(() => {
    const stackId = new URLSearchParams(window.location.search).get("stack");
    if (stackId) void load(stackId);
  }, []);

  async function create() {
    setBusy(true); setError("");
    try {
      const next = await request("/api/v3/simulate", { method: "POST", body: JSON.stringify({ productId, durationMinutes }) });
      setSimulation(next); window.history.replaceState(null, "", `${location.pathname}?stack=${encodeURIComponent(next.stackId)}${location.hash}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to start checkout."); }
    finally { setBusy(false); }
  }
  async function act(action: Action) {
    if (!simulation) return;
    setBusy(true); setError("");
    try { setSimulation(await request(`/api/v3/simulations/${encodeURIComponent(simulation.stackId)}`, { method: "POST", body: JSON.stringify({ action }) })); }
    catch (err) { setError(err instanceof Error ? err.message : "Action failed."); }
    finally { setBusy(false); }
  }
  const qr = simulation?.onramp.qrPayload.replace("coinbase-sandbox://", "") ?? "Created after checkout begins";
  const actions = simulation ? allowed[simulation.status] ?? [] : [];

  return <main className="shell">
    <header><span className="badge">PRIVATE BETA · V3 SANDBOX</span><h1>Cloud infrastructure checkout</h1><p>Rehearse a no-wallet Coinbase-style payment journey for temporary GCP infrastructure.</p></header>
    <section className="notice"><b>Simulation only.</b> No Apple Pay charge, KYC collection, USDC transfer, GCP resource, or Hyperliquid order is created. A production provider may require verification; this experience does not bypass it.</section>
    {locked && <section className="locked"><b>Private beta is locked.</b> Return to your coding-agent project, run the directory-specific <code>gcp-x402 unlock</code> command, then reopen the dashboard URL returned by the agent.</section>}
    <section className="grid">
      <article className="card"><h2>1. Choose a temporary stack</h2><label>Product<select disabled={busy || Boolean(simulation)} value={productId} onChange={(e) => setProductId(e.target.value as Product)}>{Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Duration<select disabled={busy || Boolean(simulation)} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>{[15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label><p className="muted">An embedded wallet is simulated automatically. You do not need a crypto wallet or GCP account.</p>{!simulation && <button disabled={busy} onClick={create}>{busy ? "Creating…" : "Create protected checkout"}</button>}{simulation && <div className="status"><b>Simulation</b><span>{simulation.status}</span></div>}{error && <p className="error">{error}</p>}</article>
      <article className="card"><h2>2. Apple Pay &amp; wallet handoff</h2><div className="qr"><SandboxHandoffVisual seed={qr}/><small>Coinbase sandbox handoff visual · not scannable<br/>{qr}</small></div><div className="status"><b>Apple Pay</b><span>{simulation ? simulation.onramp.applePay.replaceAll("_", " ") : "available in simulation"}</span></div><div className="status"><b>Embedded wallet</b><span>{simulation ? `${simulation.embeddedWallet.address.slice(0, 6)}…${simulation.embeddedWallet.address.slice(-4)}` : "created after checkout"}</span></div><div className="status"><b>Verification</b><span>{simulation ? simulation.onramp.kyc.replaceAll("_", " ") : "not checked"}</span></div></article>
    </section>
    {simulation && <section className="result">
      <div className="card"><h2>3. Mandate &amp; payment guardrail</h2><div className="numbers"><div><small>Expected settlement</small><b>${simulation.quote.expectedChargeUsd.toFixed(2)} USDC</b></div><div><small>Maximum authorization</small><b>${simulation.quote.authorizationCapUsd.toFixed(2)} USDC</b></div><div><small>Lease</small><b>{simulation.quote.durationMinutes} min</b></div></div><p className="muted">Mandate: {simulation.mandate.status} · expires {new Date(simulation.mandate.expiresAt).toLocaleTimeString()} · request binding {simulation.mandate.requestHash.slice(0, 16)}…</p><p>Any unused authorization is never transferred. Settlement is simulated only after simulated provisioning succeeds.</p><div className="controls">{actions.map((action) => <button key={action} className={action === "shutdown" || action === "cancel" ? "danger" : ""} disabled={busy} onClick={() => act(action)}>{busy ? "Working…" : actionLabel[action]}</button>)}</div></div>
      <div className="card"><h2>4. Infrastructure dashboard</h2><div className="status"><b>Runtime</b><span>{simulation.status}</span></div><div className="status"><b>Payment</b><span>{simulation.paymentStatus.replaceAll("_", " ")}</span></div><div className="status"><b>Expiry</b><span>{new Date(simulation.expiresAt).toLocaleTimeString()}</span></div><table><thead><tr><th>Service</th><th>Region</th><th>Role</th><th>Estimate</th></tr></thead><tbody>{simulation.resources.map((r) => <tr key={r.service}><td>{r.service}</td><td>{r.region}</td><td>{r.action}</td><td>${r.estimatedUsd.toFixed(6)}</td></tr>)}<tr className="total"><td colSpan={3}>Estimated GCP allocation</td><td>${simulation.quote.estimatedGcpUsd.toFixed(6)}</td></tr></tbody></table></div>
      <div className="card"><h2>5. Lifecycle activity</h2>{simulation.timeline.slice().reverse().map((event) => <p className="event" key={`${event.at}-${event.state}`}><b>{event.state.replaceAll("_", " ")}</b><br/><span className="muted">{event.detail} · {new Date(event.at).toLocaleTimeString()}</span></p>)}<p className="warning">{simulation.warning}</p></div>
    </section>}
    <style jsx>{`
      :global(body){margin:0;background:#07111d;color:#e8f0fa;font-family:Inter,system-ui,sans-serif}.shell{max-width:1100px;margin:auto;padding:36px 20px 70px}.badge{font-size:12px;letter-spacing:.12em;color:#63d8e8;font-weight:800}h1{font-size:36px;margin:8px 0}h2{font-size:17px;margin-top:0}.notice,.locked,.card{border:1px solid #24435d;background:#0d1b2a;border-radius:12px;padding:18px}.notice{border-color:#7c5d20;background:#241b0e;color:#f6d893;margin:22px 0}.locked{border-color:#95434d;color:#ffc6cb;margin:12px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.result{display:grid;gap:14px;margin-top:14px}label{display:grid;gap:7px;margin:13px 0;color:#afc0d1;font-size:13px}input,select{background:#07111d;border:1px solid #34536e;border-radius:7px;color:#e8f0fa;padding:10px;font:inherit}button{background:#2e83d8;border:0;color:white;border-radius:7px;padding:11px 14px;font-weight:750;cursor:pointer;margin:8px 8px 0 0}button:disabled,select:disabled{opacity:.55;cursor:not-allowed}.danger{background:#85343f}.qr{background:#eff6ff;color:#07111d;border-radius:8px;padding:18px;text-align:center;word-break:break-all}.qr svg{width:112px;height:112px;image-rendering:pixelated;display:block;margin:0 auto 10px}.qr small{font-size:10px}.status{display:flex;justify-content:space-between;border-top:1px solid #24435d;padding:9px 0;gap:14px}.numbers{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.numbers div{background:#07111d;padding:10px;border-radius:8px}.numbers small{display:block;color:#9db0c3}.numbers b{font-size:18px}.muted{color:#9db0c3;font-size:13px}.warning{color:#f6d893}.error{color:#ff99a8}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;padding:9px;border-bottom:1px solid #24435d;font-size:13px}.total td{font-weight:800}.event{border-left:2px solid #397fb9;padding-left:10px}@media(max-width:700px){.grid{grid-template-columns:1fr}.numbers{grid-template-columns:1fr}h1{font-size:29px}}
    `}</style>
  </main>;
}
