import { createHash, randomUUID } from "node:crypto";

/** V3 is intentionally a separate, simulation-first contract surface. */
export const V3_VERSION = "3.0.0-beta.1";
export const V3_DURATIONS = [15, 30, 60] as const;
export type V3DurationMinutes = (typeof V3_DURATIONS)[number];
export type V3ProductId = "trading.paper.ema" | "vm.small" | "storage.small";

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

const authCaps: Record<V3ProductId, Record<V3DurationMinutes, number>> = {
  "trading.paper.ema": { 15: 1.25, 30: 2.5, 60: 5 },
  "vm.small": { 15: 0.25, 30: 0.5, 60: 1 },
  "storage.small": { 15: 0.13, 30: 0.25, 60: 0.5 },
};

// Conservative demo allocations. These are transparent estimates, never a GCP invoice.
const hourlyGcpEstimate: Record<V3ProductId, number> = {
  "trading.paper.ema": 0.114083,
  "vm.small": 0.25,
  "storage.small": 0.1,
};

function cents(value: number): number {
  return Math.ceil((value - Number.EPSILON) * 100) / 100;
}

export function isV3Duration(value: number): value is V3DurationMinutes {
  return (V3_DURATIONS as readonly number[]).includes(value);
}

export function v3Quote(productId: V3ProductId, durationMinutes: V3DurationMinutes): V3Quote {
  const estimatedGcpUsd = Math.round(hourlyGcpEstimate[productId] * durationMinutes / 60 * 1_000_000) / 1_000_000;
  const expectedChargeUsd = cents(estimatedGcpUsd * 1.2 + 0.05);
  const authorizationCapUsd = authCaps[productId][durationMinutes];
  if (expectedChargeUsd > authorizationCapUsd) throw new Error("V3 payment plan exceeds its authorization cap.");
  return {
    productId, durationMinutes, estimatedGcpUsd,
    serviceFeeUsd: Math.round((expectedChargeUsd - estimatedGcpUsd) * 100) / 100,
    expectedChargeUsd, authorizationCapUsd, currency: "USDC",
    settlement: "provision-then-settle", unusedAuthorization: "never-transferred",
  };
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
  status: "draft" | "approved" | "consumed";
  disclaimer: string;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

export function createV3MandateDraft(input: {
  payer: string; quote: V3Quote; payTo: string; network?: "base-sepolia" | "base"; asset: string; requestId?: string; now?: Date;
}): V3MandateDraft {
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.payer) || !/^0x[a-fA-F0-9]{40}$/.test(input.payTo)) throw new Error("payer and payTo must be EVM addresses.");
  const now = input.now ?? new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  const requestId = input.requestId ?? randomUUID();
  const nonce = randomUUID();
  const requestHash = createHash("sha256").update(stableJson({ requestId, payer: input.payer.toLowerCase(), quote: input.quote, payTo: input.payTo.toLowerCase(), nonce })).digest("hex");
  return {
    version: "gcp-x402-ap2-evm-1", mandateId: randomUUID(), requestId, payer: input.payer.toLowerCase(), quote: input.quote,
    payTo: input.payTo.toLowerCase(), network: input.network ?? "base-sepolia", asset: input.asset,
    issuedAt, expiresAt, nonce, requestHash, status: "draft",
    disclaimer: "AP2-derived beta mandate. It binds a specific agent request and payment cap; it is not an independently user-signed AP2 Trusted-Surface mandate.",
  };
}

export interface V3Simulation {
  simulation: true;
  stackId: string;
  dashboardPath: string;
  quote: V3Quote;
  mandate: V3MandateDraft;
  onramp: { provider: "coinbase-sandbox"; state: "simulated"; qrPayload: string; kyc: "not-checked" };
  resources: Array<{ service: string; region: string; action: string; estimatedUsd: number }>;
  timeline: Array<{ state: string; detail: string }>;
  warning: string;
}

export function simulateV3Deployment(input: { productId: V3ProductId; durationMinutes: V3DurationMinutes; payer: string; payTo: string; asset: string; now?: Date }): V3Simulation {
  const quote = v3Quote(input.productId, input.durationMinutes);
  const mandate = createV3MandateDraft({ ...input, quote });
  const stackId = `sim-${mandate.mandateId.slice(0, 8)}`;
  const resources = input.productId === "trading.paper.ema"
    ? [
        { service: "Cloud Run", region: "asia-northeast1", action: "market-feed collector, writer, paper strategy", estimatedUsd: 0.08 },
        { service: "Pub/Sub", region: "asia-northeast1", action: "BTC market topic and subscriptions", estimatedUsd: 0.003 },
        { service: "Spanner", region: "us-central1", action: "shared tenant rows", estimatedUsd: 0.025 },
        { service: "Firebase Hosting", region: "global", action: "strategy dashboard", estimatedUsd: 0.001 },
      ]
    : [{ service: input.productId === "vm.small" ? "Compute Engine" : "Cloud Storage", region: "us-central1", action: "temporary allowlisted demo resource", estimatedUsd: quote.estimatedGcpUsd }];
  return {
    simulation: true, stackId, dashboardPath: `/v3-demo?stack=${stackId}`, quote, mandate,
    onramp: { provider: "coinbase-sandbox", state: "simulated", qrPayload: `coinbase-sandbox://onramp/${mandate.mandateId}`, kyc: "not-checked" },
    resources,
    timeline: [
      { state: "mandate_created", detail: "AP2-derived request mandate is bound to this quote and expires in 10 minutes." },
      { state: "onramp_handoff", detail: "Coinbase sandbox QR handoff is simulated. No card, wallet, or KYC data is collected." },
      { state: "payment_authorized", detail: `Would authorize up to $${quote.authorizationCapUsd.toFixed(2)} USDC; settlement would be $${quote.expectedChargeUsd.toFixed(2)} only after provisioning succeeds.` },
      { state: "provisioning_simulated", detail: "No Cloud resources, stablecoin transaction, or live Hyperliquid order was created." },
    ],
    warning: "Simulation — no money transferred and no cloud resources created. Real Coinbase onramp and x402 v2 settlement remain feature-gated until credentials and compatibility tests are complete.",
  };
}
