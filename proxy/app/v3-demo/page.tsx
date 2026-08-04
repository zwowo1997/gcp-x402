"use client";

import { useEffect, useState } from "react";

type Product = "trading.paper.ema" | "vm.small" | "storage.small";
type Action = "stop" | "resume" | "shutdown" | "cancel";
type Simulation = {
  stackId: string; status: string; paymentStatus: string; createdAt: string; expiresAt: string;
  quote: { productId: Product; expectedChargeUsd: number; authorizationCapUsd: number; estimatedGcpUsd: number; durationMinutes: number };
  mandate: { requestHash: string; expiresAt: string; status: string };
  embeddedWallet: { address: string; state: string };
  resources: Array<{ service: string; region: string; action: string; estimatedUsd: number }>;
  telemetry: {
    market: Array<{ observedAt: string; midUsd: number }>;
    strategy: { name: string; fastEma: number; slowEma: number; signal: string; virtualEquityUsd: number; positionNotionalUsd: number; sessionPnlUsd: number };
    orders: Array<{ id: string; at: string; side: string; sizeBtc: number; priceUsd: number; status: string }>;
  };
  timeline: Array<{ state: string; detail: string; at: string }>;
  warning: string;
};
type MoonPayAvailability = { enabled: boolean; mode: "test"; network: "ethereum-sepolia"; asset: "USDC"; fiatAmountUsd: number; note: string; };
type MoonPayCheckout = MoonPayAvailability & { checkoutUrl: string; warning: string };

const labels = { "trading.paper.ema": "BTC paper-trading infrastructure", "vm.small": "Temporary VM", "storage.small": "Temporary storage" } as const;
const actionLabel: Record<Action, string> = { stop: "Stop strategy", resume: "Resume strategy", shutdown: "Shut down", cancel: "Cancel checkout" };
const allowed: Record<string, Action[]> = { checkout: ["cancel"], approved: ["cancel"], funded: ["cancel"], running: ["stop", "shutdown"], stopped: ["resume", "shutdown"] };

function sessionToken() { return new URLSearchParams(window.location.hash.slice(1)).get("session"); }

export default function V3DemoPage() {
  const [productId, setProductId] = useState<Product>("trading.paper.ema");
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [moonPay, setMoonPay] = useState<MoonPayAvailability | null>(null);

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
  useEffect(() => { void request<MoonPayAvailability>("/api/v3/moonpay").then(setMoonPay).catch(() => undefined); }, []);
  useEffect(() => {
    if (!simulation || ["shutdown", "expired"].includes(simulation.status)) return;
    const timer = window.setInterval(() => void load(simulation.stackId), 5_000);
    return () => window.clearInterval(timer);
  }, [simulation?.stackId, simulation?.status]);

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
  async function openMoonPay() {
    if (!simulation) return;
    // Open synchronously from the click gesture so browsers do not block the hosted checkout.
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    setBusy(true); setError("");
    try {
      const checkout = await request<MoonPayCheckout>("/api/v3/moonpay", { method: "POST", body: JSON.stringify({ stackId: simulation.stackId }) });
      if (popup) popup.location.replace(checkout.checkoutUrl); else window.location.assign(checkout.checkoutUrl);
    } catch (err) { popup?.close(); setError(err instanceof Error ? err.message : "MoonPay checkout is unavailable."); }
    finally { setBusy(false); }
  }
  const actions = simulation ? allowed[simulation.status] ?? [] : [];
  const latestMid = simulation?.telemetry.market.at(-1)?.midUsd;

  return <main className="shell">
    <header><span className="badge">PRIVATE BETA · V3 SANDBOX</span><h1>Cloud infrastructure checkout</h1><p>Review temporary GCP infrastructure and open the provider-hosted MoonPay test checkout.</p></header>
    <section className="notice"><b>Sandbox only.</b> MoonPay owns its test payment and KYC interface. This application does not collect card details, transfer real USDC, create GCP resources, or place Hyperliquid orders.</section>
    {locked && <section className="locked"><b>Private beta is locked.</b> Return to your coding-agent project, run the directory-specific <code>gcp-x402 unlock</code> command, then reopen the dashboard URL returned by the agent.</section>}
    <section className="grid">
      <article className="card"><h2>1. Choose a temporary stack</h2><label>Product<select disabled={busy || Boolean(simulation)} value={productId} onChange={(e) => setProductId(e.target.value as Product)}>{Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Duration<select disabled={busy || Boolean(simulation)} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>{[15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label><p className="muted">An embedded wallet is simulated automatically. You do not need a crypto wallet or GCP account.</p>{!simulation && <button disabled={busy} onClick={create}>{busy ? "Creating…" : "Create protected checkout"}</button>}{simulation && <div className="status"><b>Simulation</b><span>{simulation.status}</span></div>}{error && <p className="error">{error}</p>}</article>
      <article className="card"><h2>2. MoonPay test checkout</h2><p>Payment method selection—including Apple Pay when MoonPay makes it available—happens only in MoonPay’s hosted sandbox UI.</p><div className="status"><b>Destination wallet</b><span>{simulation ? `${simulation.embeddedWallet.address.slice(0, 6)}…${simulation.embeddedWallet.address.slice(-4)}` : "created after checkout"}</span></div><div className="status"><b>On-ramp network</b><span>{moonPay?.enabled ? `${moonPay.asset} on ${moonPay.network}` : "unavailable"}</span></div>{moonPay?.enabled && <div className="status"><b>MoonPay test purchase</b><span>${moonPay.fiatAmountUsd.toFixed(2)} simulated</span></div>}{simulation && moonPay?.enabled && <button disabled={busy} onClick={openMoonPay}>Continue to MoonPay sandbox</button>}<p className="muted">{moonPay?.note ?? "MoonPay availability is checked after private-beta unlock."}</p></article>
    </section>
    {simulation && <section className="result">
      <div className="card"><h2>3. Mandate &amp; payment guardrail</h2><div className="numbers"><div><small>Expected settlement</small><b>${simulation.quote.expectedChargeUsd.toFixed(2)} USDC</b></div><div><small>Maximum authorization</small><b>${simulation.quote.authorizationCapUsd.toFixed(2)} USDC</b></div><div><small>Lease</small><b>{simulation.quote.durationMinutes} min</b></div></div><p className="muted">Mandate: {simulation.mandate.status} · expires {new Date(simulation.mandate.expiresAt).toLocaleTimeString()} · request binding {simulation.mandate.requestHash.slice(0, 16)}…</p><p>Any unused authorization is never transferred. Settlement is simulated only after simulated provisioning succeeds.</p><div className="controls">{actions.map((action) => <button key={action} className={action === "shutdown" || action === "cancel" ? "danger" : ""} disabled={busy} onClick={() => act(action)}>{busy ? "Working…" : actionLabel[action]}</button>)}</div></div>
      <div className="card"><h2>4. Infrastructure dashboard</h2><div className="status"><b>Runtime</b><span>{simulation.status}</span></div><div className="status"><b>Payment</b><span>{simulation.paymentStatus.replaceAll("_", " ")}</span></div><div className="status"><b>Expiry</b><span>{new Date(simulation.expiresAt).toLocaleTimeString()}</span></div><table><thead><tr><th>Service</th><th>Region</th><th>Role</th><th>Estimate</th></tr></thead><tbody>{simulation.resources.map((r) => <tr key={r.service}><td>{r.service}</td><td>{r.region}</td><td>{r.action}</td><td>${r.estimatedUsd.toFixed(6)}</td></tr>)}<tr className="total"><td colSpan={3}>Estimated GCP allocation</td><td>${simulation.quote.estimatedGcpUsd.toFixed(6)}</td></tr></tbody></table></div>
      {simulation.telemetry.market.length > 0 && <div className="card"><h2>5. Paper strategy telemetry</h2><div className="numbers"><div><small>BTC midpoint</small><b>${latestMid?.toLocaleString()}</b></div><div><small>Strategy signal</small><b>{simulation.telemetry.strategy.signal.replaceAll("_", " ")}</b></div><div><small>Session P&amp;L</small><b>${simulation.telemetry.strategy.sessionPnlUsd.toFixed(2)}</b></div></div><div className="status"><b>Fast / slow EMA</b><span>${simulation.telemetry.strategy.fastEma.toFixed(2)} / ${simulation.telemetry.strategy.slowEma.toFixed(2)}</span></div><div className="status"><b>Virtual equity</b><span>${simulation.telemetry.strategy.virtualEquityUsd.toFixed(2)}</span></div><div className="status"><b>Paper position</b><span>${simulation.telemetry.strategy.positionNotionalUsd.toFixed(2)} notional</span></div><table><thead><tr><th>Recent paper fill</th><th>Side</th><th>Size</th><th>Price</th></tr></thead><tbody>{simulation.telemetry.orders.slice().reverse().map((order) => <tr key={order.id}><td>{new Date(order.at).toLocaleTimeString()}</td><td>{order.side}</td><td>{order.sizeBtc} BTC</td><td>${order.priceUsd.toLocaleString()}</td></tr>)}</tbody></table><p className="muted">Deterministic simulated data for interface testing—not a live Hyperliquid feed or executable trading signal.</p></div>}
      <div className="card"><h2>6. Payment &amp; lifecycle trace</h2><p className="muted">This is the inspectable sandbox trace. MoonPay test checkout is an isolated UX rehearsal; webhook observations cannot mark this simulation paid or trigger provisioning.</p>{simulation.timeline.slice().reverse().map((event) => <p className="event" key={`${event.at}-${event.state}`}><b>{event.state.replaceAll("_", " ")}</b><br/><span className="muted">{event.detail} · {new Date(event.at).toLocaleTimeString()}</span></p>)}<p className="warning">{simulation.warning}</p></div>
    </section>}
    <style jsx>{`
      :global(body){margin:0;background:#07111d;color:#e8f0fa;font-family:Inter,system-ui,sans-serif}.shell{max-width:1100px;margin:auto;padding:36px 20px 70px}.badge{font-size:12px;letter-spacing:.12em;color:#63d8e8;font-weight:800}h1{font-size:36px;margin:8px 0}h2{font-size:17px;margin-top:0}.notice,.locked,.card{border:1px solid #24435d;background:#0d1b2a;border-radius:12px;padding:18px}.notice{border-color:#7c5d20;background:#241b0e;color:#f6d893;margin:22px 0}.locked{border-color:#95434d;color:#ffc6cb;margin:12px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.result{display:grid;gap:14px;margin-top:14px}label{display:grid;gap:7px;margin:13px 0;color:#afc0d1;font-size:13px}input,select{background:#07111d;border:1px solid #34536e;border-radius:7px;color:#e8f0fa;padding:10px;font:inherit}button{background:#2e83d8;border:0;color:white;border-radius:7px;padding:11px 14px;font-weight:750;cursor:pointer;margin:8px 8px 0 0}button:disabled,select:disabled{opacity:.55;cursor:not-allowed}.danger{background:#85343f}.status{display:flex;justify-content:space-between;border-top:1px solid #24435d;padding:9px 0;gap:14px}.numbers{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.numbers div{background:#07111d;padding:10px;border-radius:8px}.numbers small{display:block;color:#9db0c3}.numbers b{font-size:18px}.muted{color:#9db0c3;font-size:13px}.warning{color:#f6d893}.error{color:#ff99a8}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;padding:9px;border-bottom:1px solid #24435d;font-size:13px}.total td{font-weight:800}.event{border-left:2px solid #397fb9;padding-left:10px}@media(max-width:700px){.grid{grid-template-columns:1fr}.numbers{grid-template-columns:1fr}h1{font-size:29px}}
    `}</style>
  </main>;
}
