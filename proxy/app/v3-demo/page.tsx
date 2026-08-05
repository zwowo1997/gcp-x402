"use client";

import { useEffect, useState } from "react";

type Action = "stop" | "resume" | "shutdown";
type Simulation = {
  stackId: string; status: string; paymentStatus: string; createdAt: string; expiresAt: string;
  quote: { estimatedGcpUsd: number; durationMinutes: number };
  resources: Array<{ service: string; region: string; action: string; estimatedUsd: number }>;
  telemetry: {
    market: Array<{ observedAt: string; midUsd: number }>;
    strategy: { name: string; fastEma: number; slowEma: number; signal: string; virtualEquityUsd: number; positionNotionalUsd: number; sessionPnlUsd: number };
    orders: Array<{ id: string; at: string; side: string; sizeBtc: number; priceUsd: number; status: string }>;
  };
  timeline: Array<{ state: string; detail: string; at: string }>;
  warning: string;
};

const actionLabel: Record<Action, string> = { stop: "Stop strategy", resume: "Resume strategy", shutdown: "Shut down" };
const allowed: Record<string, Action[]> = { running: ["stop", "shutdown"], stopped: ["resume", "shutdown"] };

function sessionToken() { return new URLSearchParams(window.location.hash.slice(1)).get("session"); }

export default function V3DemoPage() {
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);

  async function request<T = Simulation>(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    const token = sessionToken(); if (token) headers.set("x-gcp-x402-session", token);
    const response = await fetch(url, { ...init, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) setLocked(true);
      throw new Error(body.error ?? "Request failed.");
    }
    return body as T;
  }
  async function load(stackId: string) {
    try { setSimulation(await request(`/api/v3/simulations/${encodeURIComponent(stackId)}`)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load simulation."); }
  }
  useEffect(() => {
    const stackId = new URLSearchParams(window.location.search).get("stack");
    if (stackId) void load(stackId);
  }, []);
  useEffect(() => {
    if (!simulation || ["shutdown", "expired"].includes(simulation.status)) return;
    const timer = window.setInterval(() => void load(simulation.stackId), 5_000);
    return () => window.clearInterval(timer);
  }, [simulation?.stackId, simulation?.status]);

  async function act(action: Action) {
    if (!simulation) return;
    setBusy(true); setError("");
    try { setSimulation(await request(`/api/v3/simulations/${encodeURIComponent(simulation.stackId)}`, { method: "POST", body: JSON.stringify({ action }) })); }
    catch (err) { setError(err instanceof Error ? err.message : "Action failed."); }
    finally { setBusy(false); }
  }
  const actions = simulation ? allowed[simulation.status] ?? [] : [];
  const latestMid = simulation?.telemetry.market.at(-1)?.midUsd;

  return <main className="shell">
    <header><span className="badge">PRIVATE BETA · PAPER ONLY</span><h1>Strategy &amp; GCP monitor</h1><p>Runtime telemetry, cloud-resource inventory, estimated cost, lease status, and controls.</p></header>
    <section className="notice"><b>Monitoring only.</b> Payment selection and wallet funding are intentionally excluded from this dashboard. Trading data and orders shown in V3 are simulated.</section>
    {locked && <section className="locked"><b>Private beta is locked.</b> Return to your coding-agent project, run the directory-specific <code>gcp-x402 unlock</code> command, then reopen the dashboard URL returned by the agent.</section>}
    {!simulation && <section className="card"><h2>No stack selected</h2><p className="muted">Open the monitoring URL returned by gcp-x402 after a stack has been prepared.</p>{error && <p className="error">{error}</p>}</section>}
    {simulation && <section className="result">
      <div className="card"><h2>Infrastructure &amp; cost</h2><div className="numbers"><div><small>Runtime</small><b>{simulation.status}</b></div><div><small>Lease</small><b>{simulation.quote.durationMinutes} min</b></div><div><small>Estimated GCP</small><b>${simulation.quote.estimatedGcpUsd.toFixed(6)}</b></div></div><div className="status"><b>Expiry</b><span>{new Date(simulation.expiresAt).toLocaleTimeString()}</span></div><table><thead><tr><th>Service</th><th>Region</th><th>Role</th><th>Estimate</th></tr></thead><tbody>{simulation.resources.map((r) => <tr key={r.service}><td>{r.service}</td><td>{r.region}</td><td>{r.action}</td><td>${r.estimatedUsd.toFixed(6)}</td></tr>)}<tr className="total"><td colSpan={3}>Estimated GCP allocation</td><td>${simulation.quote.estimatedGcpUsd.toFixed(6)}</td></tr></tbody></table><div className="controls">{actions.map((action) => <button key={action} className={action === "shutdown" ? "danger" : ""} disabled={busy} onClick={() => act(action)}>{busy ? "Working…" : actionLabel[action]}</button>)}</div></div>
      {simulation.telemetry.market.length > 0 && <div className="card"><h2>Paper strategy telemetry</h2><div className="numbers"><div><small>BTC midpoint</small><b>${latestMid?.toLocaleString()}</b></div><div><small>Strategy signal</small><b>{simulation.telemetry.strategy.signal.replaceAll("_", " ")}</b></div><div><small>Session P&amp;L</small><b>${simulation.telemetry.strategy.sessionPnlUsd.toFixed(2)}</b></div></div><div className="status"><b>Fast / slow EMA</b><span>${simulation.telemetry.strategy.fastEma.toFixed(2)} / ${simulation.telemetry.strategy.slowEma.toFixed(2)}</span></div><div className="status"><b>Virtual equity</b><span>${simulation.telemetry.strategy.virtualEquityUsd.toFixed(2)}</span></div><div className="status"><b>Paper position</b><span>${simulation.telemetry.strategy.positionNotionalUsd.toFixed(2)} notional</span></div><table><thead><tr><th>Recent paper fill</th><th>Side</th><th>Size</th><th>Price</th></tr></thead><tbody>{simulation.telemetry.orders.slice().reverse().map((order) => <tr key={order.id}><td>{new Date(order.at).toLocaleTimeString()}</td><td>{order.side}</td><td>{order.sizeBtc} BTC</td><td>${order.priceUsd.toLocaleString()}</td></tr>)}</tbody></table><p className="muted">Deterministic simulated data for interface testing—not a live Hyperliquid feed or executable trading signal.</p></div>}
      <div className="card"><h2>Runtime lifecycle</h2>{simulation.timeline.slice().reverse().map((event) => <p className="event" key={`${event.at}-${event.state}`}><b>{event.state.replaceAll("_", " ")}</b><br/><span className="muted">{event.detail} · {new Date(event.at).toLocaleTimeString()}</span></p>)}<p className="warning">{simulation.warning}</p></div>
    </section>}
    <style jsx>{`
      :global(body){margin:0;background:#07111d;color:#e8f0fa;font-family:Inter,system-ui,sans-serif}.shell{max-width:1100px;margin:auto;padding:36px 20px 70px}.badge{font-size:12px;letter-spacing:.12em;color:#63d8e8;font-weight:800}h1{font-size:36px;margin:8px 0}h2{font-size:17px;margin-top:0}.notice,.locked,.card{border:1px solid #24435d;background:#0d1b2a;border-radius:12px;padding:18px}.notice{border-color:#7c5d20;background:#241b0e;color:#f6d893;margin:22px 0}.locked{border-color:#95434d;color:#ffc6cb;margin:12px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.result{display:grid;gap:14px;margin-top:14px}label{display:grid;gap:7px;margin:13px 0;color:#afc0d1;font-size:13px}input,select{background:#07111d;border:1px solid #34536e;border-radius:7px;color:#e8f0fa;padding:10px;font:inherit}button{background:#2e83d8;border:0;color:white;border-radius:7px;padding:11px 14px;font-weight:750;cursor:pointer;margin:8px 8px 0 0}button:disabled,select:disabled{opacity:.55;cursor:not-allowed}.danger{background:#85343f}.status{display:flex;justify-content:space-between;border-top:1px solid #24435d;padding:9px 0;gap:14px}.numbers{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.numbers div{background:#07111d;padding:10px;border-radius:8px}.numbers small{display:block;color:#9db0c3}.numbers b{font-size:18px}.muted{color:#9db0c3;font-size:13px}.warning{color:#f6d893}.error{color:#ff99a8}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;padding:9px;border-bottom:1px solid #24435d;font-size:13px}.total td{font-weight:800}.event{border-left:2px solid #397fb9;padding-left:10px}@media(max-width:700px){.grid{grid-template-columns:1fr}.numbers{grid-template-columns:1fr}h1{font-size:29px}}
    `}</style>
  </main>;
}
