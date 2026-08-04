// Thin client over the gcp-x402 proxy that handles x402 payment automatically.
//
// `x402-fetch` does the heavy lifting: on a 402 it reads the PaymentRequirements,
// signs an EIP-3009 USDC authorization with the agent's wallet, and retries.

import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { randomUUID } from "node:crypto";
import { createPublicClient, http, formatUnits } from "viem";
import { config } from "./config.js";
import { getAccount } from "./wallet.js";
import { networkById, type ClientNetwork } from "./networks.js";
import { betaSessionToken, saveBetaSession } from "./beta-session.js";
import { lockedServiceHelp } from "./project-context.js";
import { clearPendingTradingRequest, pendingTradingRequestId, recentTradingReceipt, saveTradingReceipt, tradingConfigJson, type TradingReceipt } from "./trading-receipt.js";

// Cap what the wrapper will auto-pay without a fresh decision, in USDC base
// units (6 decimals). A hard backstop against a mispriced/hostile quote.
const maxAutoPayBaseUnits = BigInt(Math.ceil(config.maxPaymentUsd * 1e6));

const serviceFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  const session = betaSessionToken();
  if (session) headers.set("x-gcp-x402-session", session);
  return fetch(input, { ...init, headers });
};

/** Create/load a wallet only for an operation that can actually pay. */
function paidFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  return wrapFetchWithPayment(serviceFetch, getAccount(), maxAutoPayBaseUnits)(input, init);
}

async function serviceError(response: Response, operation: string): Promise<Error> {
  const body = await response.text();
  if (response.status === 401) {
    return new Error(`${operation} failed (401): ${body}\n\n${lockedServiceHelp()}`);
  }
  return new Error(`${operation} failed (${response.status}): ${body}`);
}

export function walletAddress(): string { return getAccount().address; }

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

interface DatasetsInfo {
  network?: string;
  pricing?: unknown;
}

/** Ask the proxy which network/asset it settles on (free, unauthenticated). */
async function proxyNetwork(): Promise<ClientNetwork> {
  try {
    const res = await serviceFetch(new URL("/api/datasets", config.proxyUrl));
    if (res.ok) {
      const data = (await res.json()) as DatasetsInfo;
      if (data.network) return networkById(data.network);
    }
  } catch {
    /* fall through to default */
  }
  return networkById("base-sepolia");
}

export interface BetaUnlockResult { expiresAt: string; }

export async function unlockService(password: string): Promise<BetaUnlockResult> {
  const response = await fetch(new URL("/api/beta/unlock", config.proxyUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Unlock failed (${response.status}): ${text}`);
  const session = JSON.parse(text) as { token: string; expiresAt: string };
  if (!session.token || !session.expiresAt) throw new Error("Unlock response did not contain a session.");
  saveBetaSession(session);
  return { expiresAt: session.expiresAt };
}

export interface WalletInfo {
  address: string;
  network: string;
  usdcBalance: string;
  fundingHint: string;
}

/** Address + live USDC balance + how to fund it. */
export async function walletInfo(): Promise<WalletInfo> {
  const account = getAccount();
  const net = await proxyNetwork();
  const pub = createPublicClient({ transport: http(net.rpcUrl) });

  let balance = "unknown";
  try {
    const raw = (await pub.readContract({
      address: net.usdcAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    balance = formatUnits(raw, 6);
  } catch {
    /* RPC hiccup — leave as unknown */
  }

  const funding =
    `Send USDC on ${net.label} to ${account.address}.` +
    (net.faucetHint ? ` ${net.faucetHint}` : "");

  return { address: account.address, network: net.id, usdcBalance: balance, fundingHint: funding };
}

export interface QuoteInfo {
  priceUsd: number;
  priceBaseUnits: string;
  bytes: number;
  network: string;
  description: string;
}

/** Decode the human-readable bits of a 402 body without paying. */
function parseQuote(body: {
  accepts?: Array<{
    maxAmountRequired?: string;
    network?: string;
    description?: string;
    extra?: { quote?: string };
  }>;
}): QuoteInfo | null {
  const req = body.accepts?.[0];
  if (!req?.maxAmountRequired) return null;

  let bytes = 0;
  const token = req.extra?.quote;
  if (token) {
    try {
      const payloadB64 = token.slice(0, token.lastIndexOf("."));
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
      bytes = Number(payload.bytes ?? 0);
    } catch {
      /* token is opaque to us; ignore */
    }
  }

  return {
    priceBaseUnits: req.maxAmountRequired,
    priceUsd: Number(req.maxAmountRequired) / 1e6,
    bytes,
    network: req.network ?? "unknown",
    description: req.description ?? "",
  };
}

/** Price a query without paying (call 1 of the x402 handshake only). */
export async function estimate(sql: string): Promise<QuoteInfo> {
  const res = await serviceFetch(new URL("/api/query", config.proxyUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql }),
  });

  if (res.status === 402) {
    const quote = parseQuote((await res.json()) as Parameters<typeof parseQuote>[0]);
    if (!quote) throw new Error("Proxy returned 402 without a parseable quote.");
    return quote;
  }
  const text = await res.text();
  throw new Error(`Expected 402 with a quote, got ${res.status}: ${text}`);
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  billing: Record<string, unknown>;
  settlement?: unknown;
}

/** Run a query, paying automatically via x402. */
export async function query(sql: string): Promise<QueryResult> {
  let res: Response;
  try {
    res = await paidFetch(new URL("/api/query", config.proxyUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql }),
    });
  } catch (e) {
    // x402-fetch throws if the price exceeds maxAutoPayBaseUnits, among others.
    throw new Error(
      `Payment/query failed: ${(e as Error).message}. ` +
        `(Auto-pay cap is $${config.maxPaymentUsd}; check wallet balance with the wallet_info tool.)`,
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Query failed (${res.status}): ${text}`);
  }

  const data = JSON.parse(text);
  const paymentResponse = res.headers.get("x-payment-response");
  return {
    rows: data.rows ?? [],
    rowCount: data.rowCount ?? 0,
    truncated: Boolean(data.truncated),
    billing: data.billing ?? {},
    settlement: paymentResponse ? decodeXPaymentResponse(paymentResponse) : undefined,
  };
}

export async function listDatasets(): Promise<unknown> {
  const res = await serviceFetch(new URL("/api/datasets", config.proxyUrl));
  if (!res.ok) throw new Error(`/api/datasets failed: ${res.status}`);
  return res.json();
}

export type V3ProductId = "trading.paper.ema" | "vm.small" | "storage.small";
export type V3DurationMinutes = 15 | 30 | 60;
export type V3SimulationAction = "approve" | "fund" | "provision" | "stop" | "resume" | "shutdown" | "cancel";
export interface V3SimulationResult { stackId: string; dashboardPath: string; dashboardUrl?: string; [key: string]: unknown; }
export interface MoonPayAvailabilityResult { enabled: boolean; mode: "test"; network: "ethereum-sepolia"; asset: "USDC"; fiatAmountUsd: number; note: string; }
export interface MoonPayCheckoutResult extends MoonPayAvailabilityResult { provider: "moonpay"; checkoutUrl: string; enabled: true; warning: string; }

/**
 * V3 dry-run only. It deliberately uses ordinary fetch rather than paidFetch:
 * this endpoint cannot transfer funds or provision cloud resources.
 */
export async function v3Catalog(): Promise<unknown> {
  const res = await serviceFetch(new URL("/api/v3/catalog", config.proxyUrl));
  if (!res.ok) throw await serviceError(res, "V3 catalog");
  return res.json();
}

function v3DashboardUrl(path: string): string | undefined {
  const session = betaSessionToken();
  if (!session) return undefined;
  const dashboard = new URL(path, config.proxyUrl);
  dashboard.hash = new URLSearchParams({ session }).toString();
  return dashboard.toString();
}

export async function simulateV3Deployment(input: { productId: V3ProductId; durationMinutes: V3DurationMinutes; payer?: string; requestId?: string }): Promise<V3SimulationResult> {
  const res = await serviceFetch(new URL("/api/v3/simulate", config.proxyUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await serviceError(res, "V3 simulation");
  const result = await res.json() as V3SimulationResult;
  return { ...result, dashboardUrl: typeof result.dashboardPath === "string" ? v3DashboardUrl(result.dashboardPath) : undefined };
}

export async function v3SimulationStatus(stackId: string): Promise<V3SimulationResult> {
  const res = await serviceFetch(new URL(`/api/v3/simulations/${encodeURIComponent(stackId)}`, config.proxyUrl));
  if (!res.ok) throw await serviceError(res, "V3 simulation status");
  const result = await res.json() as V3SimulationResult;
  return { ...result, dashboardUrl: typeof result.dashboardPath === "string" ? v3DashboardUrl(result.dashboardPath) : undefined };
}

export async function controlV3Simulation(stackId: string, action: V3SimulationAction): Promise<V3SimulationResult> {
  const res = await serviceFetch(new URL(`/api/v3/simulations/${encodeURIComponent(stackId)}`, config.proxyUrl), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
  });
  if (!res.ok) throw await serviceError(res, "V3 simulation control");
  const result = await res.json() as V3SimulationResult;
  return { ...result, dashboardUrl: typeof result.dashboardPath === "string" ? v3DashboardUrl(result.dashboardPath) : undefined };
}

/** Open MoonPay's hosted on-ramp; this beta never uses its outcome to provision or settle. */
export async function moonPayAvailability(): Promise<MoonPayAvailabilityResult> {
  const res = await serviceFetch(new URL("/api/v3/moonpay", config.proxyUrl));
  if (!res.ok) throw await serviceError(res, "MoonPay availability");
  return res.json() as Promise<MoonPayAvailabilityResult>;
}

export async function moonPayCheckout(stackId: string): Promise<MoonPayCheckoutResult> {
  const res = await serviceFetch(new URL("/api/v3/moonpay", config.proxyUrl), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stackId }),
  });
  if (!res.ok) throw await serviceError(res, "MoonPay checkout");
  return res.json() as Promise<MoonPayCheckoutResult>;
}

export interface ProvisionRequest { resourceId: "vm.small" | "storage.small"; durationMinutes?: number; }
export interface ProvisionResult { jobId: string; resourceId: string; expiresAt: string; maxPriceUsd: number; capability: string; }
export async function provisionCatalog(): Promise<unknown> {
  const res = await serviceFetch(new URL("/api/catalog", config.proxyUrl));
  if (!res.ok) throw await serviceError(res, "Provision catalog");
  return res.json();
}
export async function provisionResource(input: ProvisionRequest): Promise<ProvisionResult> {
  const res = await paidFetch(new URL("/api/provision", config.proxyUrl), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Provisioning failed (${res.status}): ${text}`);
  return JSON.parse(text);
}
export async function provisionStatus(jobId: string, capability: string): Promise<unknown> {
  const res = await serviceFetch(new URL(`/api/provision/${encodeURIComponent(jobId)}`, config.proxyUrl), { headers: { "x-resource-capability": capability } });
  if (!res.ok) throw new Error(`Provision status failed (${res.status})`);
  return res.json();
}
export async function provisionDelete(jobId: string, capability: string): Promise<unknown> {
  const res = await serviceFetch(new URL(`/api/provision/${encodeURIComponent(jobId)}`, config.proxyUrl), { method: "DELETE", headers: { "x-resource-capability": capability } });
  if (!res.ok) throw new Error(`Provision delete failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export interface PaperTradingConfig {
  fastEma?: number;
  slowEma?: number;
  virtualBalanceUsd?: number;
  maxOrderNotionalUsd?: number;
  maxPositionNotionalUsd?: number;
  maxDailyLossUsd?: number;
  slippageBps?: number;
}

export interface PaperTradingDeployment {
  stackId: string;
  mode: "paper";
  region: string;
  expiresAt: string;
  maxPriceUsd: number;
  capability: string;
  dashboardUrl?: string;
  paperOnly: true;
  resources?: Record<string, string>;
  costBreakdown?: Array<Record<string, unknown>>;
  costSummary?: Record<string, unknown>;
  reusedReceipt?: boolean;
  reuseReason?: string;
}

export async function tradingCatalog(): Promise<unknown> {
  const res = await serviceFetch(new URL("/api/trading/catalog", config.proxyUrl));
  if (!res.ok) throw await serviceError(res, "Trading catalog");
  return res.json();
}

export async function deployPaperTrading(configInput: PaperTradingConfig = {}, options: { allowAdditionalStack?: boolean } = {}): Promise<PaperTradingDeployment> {
  if (!options.allowAdditionalStack) {
    const receipt = recentTradingReceipt(configInput);
    if (receipt) return { ...receipt, reusedReceipt: true, reuseReason: "Returned the recent successful receipt instead of creating another paid stack. Use an explicitly approved additional-stack option only when a separate stack is intended." };
  }
  const requestId = pendingTradingRequestId(configInput, randomUUID);
  const res = await paidFetch(new URL("/api/trading/deploy", config.proxyUrl), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: "trading.paper.ema", requestId, config: configInput }),
  });
  const text = await res.text();
  if (!res.ok) {
    const terminal = (res.status === 409 && text.includes("finished without a reusable result"))
      || (res.status === 502 && text.includes("Paper trading provisioning failed"));
    if (terminal) clearPendingTradingRequest(requestId);
    throw new Error(`Paper trading deployment failed (${res.status}): ${text}`);
  }
  const deployment = JSON.parse(text) as PaperTradingDeployment;
  saveTradingReceipt({ ...deployment, requestId, configJson: tradingConfigJson(configInput), savedAt: new Date().toISOString() } satisfies TradingReceipt);
  clearPendingTradingRequest(requestId);
  return deployment;
}

export async function tradingStatus(stackId: string, capability: string): Promise<unknown> {
  const res = await serviceFetch(new URL(`/api/trading/${encodeURIComponent(stackId)}`, config.proxyUrl), { headers: { "x-resource-capability": capability } });
  if (!res.ok) throw new Error(`Trading status failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function controlPaperTrading(stackId: string, capability: string, control: "start" | "stop" | "resume" | "shutdown"): Promise<unknown> {
  const res = await serviceFetch(new URL(`/api/trading/${encodeURIComponent(stackId)}/control`, config.proxyUrl), { method: "POST", headers: { "content-type": "application/json", "x-resource-capability": capability }, body: JSON.stringify({ control }) });
  if (!res.ok) throw new Error(`Trading control failed (${res.status}): ${await res.text()}`);
  return res.json();
}
