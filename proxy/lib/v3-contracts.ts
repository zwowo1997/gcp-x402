import { createHash, randomUUID } from "node:crypto";

/** V3 is an isolated, non-financial checkout rehearsal. */
export const V3_VERSION = "3.0.0-beta.3";
export const V3_DURATIONS = [15, 30, 60] as const;
export type V3DurationMinutes = (typeof V3_DURATIONS)[number];
export type V3ProductId = "trading.paper.ema" | "vm.small" | "storage.small";
export type V3SimulationStatus = "checkout" | "approved" | "funded" | "provisioning" | "running" | "stopped" | "shutdown" | "expired";
export type V3PaymentStatus = "not_authorized" | "authorized" | "funded" | "settled_simulated" | "cancelled";

export interface V3Quote {
  productId: V3ProductId;
  durationMinutes: V3DurationMinutes;
  estimatedGcpUsd: number;
  serviceFeeUsd: number;
  expectedChargeUsd: number;
  authorizationCapUsd: number;
  currency: "USDC";
  settlement: "provision-then-settle";
  unusedAuthorization: "never-transferred";
}

export interface V3Resource {
  service: string;
  region: string;
  action: string;
  estimatedUsd: number;
}

export interface V3Telemetry {
  market: Array<{ observedAt: string; midUsd: number }>;
  strategy: {
    name: "BTC EMA hedge (paper)";
    fastEma: number;
    slowEma: number;
    signal: "warming_up" | "short_hedge" | "stopped";
    virtualEquityUsd: number;
    positionNotionalUsd: number;
    sessionPnlUsd: number;
  };
  orders: Array<{ id: string; at: string; side: "sell" | "buy"; sizeBtc: number; priceUsd: number; status: "simulated_fill" }>;
}

const authorizationCaps: Record<V3ProductId, Record<V3DurationMinutes, number>> = {
  "trading.paper.ema": { 15: 1.25, 30: 2.5, 60: 5 },
  "vm.small": { 15: 0.25, 30: 0.5, 60: 1 },
  "storage.small": { 15: 0.13, 30: 0.25, 60: 0.5 },
};

// These one-hour allocations deliberately sum to the quoted hourly estimate.
const tradingHourlyResources: V3Resource[] = [
  { service: "Cloud Run", region: "asia-northeast1", action: "market-feed collector, Pub/Sub writer, paper strategy", estimatedUsd: 0.110833 },
  { service: "Pub/Sub", region: "asia-northeast1", action: "BTC market topic and two subscriptions", estimatedUsd: 0.000125 },
  { service: "Spanner", region: "us-central1", action: "shared tenant-isolated market and strategy rows", estimatedUsd: 0.002083 },
  { service: "Firebase Hosting", region: "global", action: "strategy dashboard", estimatedUsd: 0.000042 },
  { service: "Cloud Tasks", region: "asia-northeast1", action: "automatic simulation expiry", estimatedUsd: 0.001 },
];
const hourlyGcpEstimate: Record<V3ProductId, number> = {
  "trading.paper.ema": 0.114083,
  "vm.small": 0.25,
  "storage.small": 0.1,
};

const roundUsd = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const cents = (value: number) => Math.ceil((value - Number.EPSILON) * 100) / 100;

export function isV3Duration(value: number): value is V3DurationMinutes {
  return (V3_DURATIONS as readonly number[]).includes(value);
}

export function v3Quote(productId: V3ProductId, durationMinutes: V3DurationMinutes): V3Quote {
  const estimatedGcpUsd = roundUsd(hourlyGcpEstimate[productId] * durationMinutes / 60);
  const expectedChargeUsd = cents(estimatedGcpUsd * 1.2 + 0.05);
  const authorizationCapUsd = authorizationCaps[productId][durationMinutes];
  if (expectedChargeUsd > authorizationCapUsd) throw new Error("V3 payment plan exceeds its authorization cap.");
  return {
    productId, durationMinutes, estimatedGcpUsd,
    serviceFeeUsd: roundUsd(expectedChargeUsd - estimatedGcpUsd),
    expectedChargeUsd, authorizationCapUsd, currency: "USDC",
    settlement: "provision-then-settle", unusedAuthorization: "never-transferred",
  };
}

/** The resource table and quote share one source of truth, including proration. */
export function v3ResourceBreakdown(quote: V3Quote): V3Resource[] {
  if (quote.productId !== "trading.paper.ema") {
    return [{ service: quote.productId === "vm.small" ? "Compute Engine" : "Cloud Storage", region: "us-central1", action: "temporary allowlisted demo resource", estimatedUsd: quote.estimatedGcpUsd }];
  }
  const factor = quote.durationMinutes / 60;
  const rows = tradingHourlyResources.map((item) => ({ ...item, estimatedUsd: roundUsd(item.estimatedUsd * factor) }));
  // Preserve an exact visible total after micro-dollar rounding.
  const difference = roundUsd(quote.estimatedGcpUsd - rows.reduce((sum, item) => sum + item.estimatedUsd, 0));
  rows[0].estimatedUsd = roundUsd(rows[0].estimatedUsd + difference);
  return rows;
}

export interface V3MandateDraft {
  version: "gcp-x402-ap2-evm-1";
  mandateId: string;
  requestId: string;
  payer: string;
  quote: V3Quote;
  payTo: string;
  network: "base-sepolia" | "base";
  asset: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  requestHash: string;
  status: "draft" | "approved" | "consumed" | "expired" | "cancelled";
  disclaimer: string;
}

/** Canonical JSON for deterministic security binding; keys are sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function mandateHashPayload(mandate: Omit<V3MandateDraft, "requestHash" | "status" | "disclaimer">): Record<string, unknown> {
  return {
    version: mandate.version, mandateId: mandate.mandateId, requestId: mandate.requestId,
    payer: mandate.payer, quote: mandate.quote, payTo: mandate.payTo, network: mandate.network,
    asset: mandate.asset, issuedAt: mandate.issuedAt, expiresAt: mandate.expiresAt, nonce: mandate.nonce,
  };
}

export function hashMandatePayload(mandate: Omit<V3MandateDraft, "requestHash" | "status" | "disclaimer">): string {
  return createHash("sha256").update(canonicalJson(mandateHashPayload(mandate))).digest("hex");
}

export function createV3MandateDraft(input: {
  payer: string; quote: V3Quote; payTo: string; network?: "base-sepolia" | "base"; asset: string;
  requestId?: string; mandateId?: string; nonce?: string; now?: Date;
}): V3MandateDraft {
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.payer) || !/^0x[a-fA-F0-9]{40}$/.test(input.payTo)) throw new Error("payer and payTo must be EVM addresses.");
  const now = input.now ?? new Date();
  const unsigned = {
    version: "gcp-x402-ap2-evm-1" as const, mandateId: input.mandateId ?? randomUUID(), requestId: input.requestId ?? randomUUID(),
    payer: input.payer.toLowerCase(), quote: input.quote, payTo: input.payTo.toLowerCase(), network: input.network ?? "base-sepolia",
    asset: input.asset, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(), nonce: input.nonce ?? randomUUID(),
  };
  return {
    ...unsigned, requestHash: hashMandatePayload(unsigned), status: "draft",
    disclaimer: "AP2-derived beta mandate. It binds one simulated request and payment cap; it is not an independently user-signed AP2 Trusted-Surface mandate.",
  };
}

export interface V3Simulation {
  simulation: true;
  stackId: string;
  dashboardPath: string;
  createdAt: string;
  expiresAt: string;
  status: V3SimulationStatus;
  paymentStatus: V3PaymentStatus;
  quote: V3Quote;
  mandate: V3MandateDraft;
  embeddedWallet: { provider: "coinbase-sandbox"; address: string; state: "created_simulated" };
  onramp: { provider: "coinbase-sandbox"; state: "not_started" | "approved" | "funded_simulated"; applePay: "available_in_simulation"; kyc: "not_checked"; qrPayload: string };
  resources: V3Resource[];
  telemetry: V3Telemetry;
  timeline: Array<{ state: string; detail: string; at: string }>;
  warning: string;
}

export function simulatedV3Telemetry(stackId: string, createdAt: string): V3Telemetry {
  const seed = Number.parseInt(createHash("sha256").update(stackId).digest("hex").slice(0, 8), 16);
  const base = 63_000 + seed % 1_500;
  const start = new Date(createdAt).getTime();
  const market = Array.from({ length: 24 }, (_, index) => ({
    observedAt: new Date(start + index * 15_000).toISOString(),
    midUsd: Math.round((base + Math.sin(index / 2.7) * 95 - index * 3.4) * 100) / 100,
  }));
  const latest = market.at(-1)!.midUsd;
  return {
    market,
    strategy: { name: "BTC EMA hedge (paper)", fastEma: latest - 8.12, slowEma: latest + 14.47, signal: "short_hedge", virtualEquityUsd: 10_003.42, positionNotionalUsd: -1_250, sessionPnlUsd: 3.42 },
    orders: [
      { id: `paper-${stackId.slice(-8)}-1`, at: market[16].observedAt, side: "sell", sizeBtc: 0.01, priceUsd: market[16].midUsd, status: "simulated_fill" },
      { id: `paper-${stackId.slice(-8)}-2`, at: market[21].observedAt, side: "sell", sizeBtc: 0.01, priceUsd: market[21].midUsd, status: "simulated_fill" },
    ],
  };
}

export function simulatedEmbeddedWallet(seed: string): string {
  return `0x${createHash("sha256").update(`gcp-x402-v3:${seed}`).digest("hex").slice(0, 40)}`;
}

export function simulateV3Deployment(input: { productId: V3ProductId; durationMinutes: V3DurationMinutes; payer?: string; payTo: string; network?: "base-sepolia" | "base"; asset: string; now?: Date; requestId?: string }): V3Simulation {
  const now = input.now ?? new Date();
  const quote = v3Quote(input.productId, input.durationMinutes);
  const stackId = `sim-${randomUUID()}`;
  const payer = input.payer ?? simulatedEmbeddedWallet(stackId);
  const mandate = createV3MandateDraft({ payer, quote, payTo: input.payTo, network: input.network, asset: input.asset, requestId: input.requestId, now });
  return {
    simulation: true, stackId, dashboardPath: `/v3-demo?stack=${encodeURIComponent(stackId)}`,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + quote.durationMinutes * 60_000).toISOString(), status: "checkout", paymentStatus: "not_authorized",
    quote, mandate, embeddedWallet: { provider: "coinbase-sandbox", address: payer, state: "created_simulated" },
    onramp: { provider: "coinbase-sandbox", state: "not_started", applePay: "available_in_simulation", kyc: "not_checked", qrPayload: `coinbase-sandbox://onramp/${mandate.mandateId}` },
    resources: v3ResourceBreakdown(quote),
    telemetry: { market: [], strategy: { name: "BTC EMA hedge (paper)", fastEma: 0, slowEma: 0, signal: "warming_up", virtualEquityUsd: 10_000, positionNotionalUsd: 0, sessionPnlUsd: 0 }, orders: [] },
    timeline: [{ state: "showcase_created", at: now.toISOString(), detail: "Provider handoff showcase prepared. No wallet, card, KYC record, payment, or cloud resource exists; no trade can follow." }],
    warning: "Simulation — no money transferred and no cloud resources created. Coinbase, x402 v2 settlement, and Hyperliquid execution remain feature-gated.",
  };
}
