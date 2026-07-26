// Thin client over the gcp-x402 proxy that handles x402 payment automatically.
//
// `x402-fetch` does the heavy lifting: on a 402 it reads the PaymentRequirements,
// signs an EIP-3009 USDC authorization with the agent's wallet, and retries.

import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { createPublicClient, http, formatUnits } from "viem";
import { config } from "./config.js";
import { getAccount } from "./wallet.js";
import { networkById, type ClientNetwork } from "./networks.js";

const account = getAccount();

// Cap what the wrapper will auto-pay without a fresh decision, in USDC base
// units (6 decimals). A hard backstop against a mispriced/hostile quote.
const maxAutoPayBaseUnits = BigInt(Math.ceil(config.maxPaymentUsd * 1e6));

const paidFetch = wrapFetchWithPayment(fetch, account, maxAutoPayBaseUnits);

export const walletAddress = account.address;

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
    const res = await fetch(new URL("/api/datasets", config.proxyUrl));
    if (res.ok) {
      const data = (await res.json()) as DatasetsInfo;
      if (data.network) return networkById(data.network);
    }
  } catch {
    /* fall through to default */
  }
  return networkById("base-sepolia");
}

export interface WalletInfo {
  address: string;
  network: string;
  usdcBalance: string;
  fundingHint: string;
}

/** Address + live USDC balance + how to fund it. */
export async function walletInfo(): Promise<WalletInfo> {
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
  const res = await fetch(new URL("/api/query", config.proxyUrl), {
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
  const res = await fetch(new URL("/api/datasets", config.proxyUrl));
  if (!res.ok) throw new Error(`/api/datasets failed: ${res.status}`);
  return res.json();
}

export interface ProvisionRequest { resourceId: "vm.small" | "storage.small"; durationMinutes?: number; }
export interface ProvisionResult { jobId: string; resourceId: string; expiresAt: string; maxPriceUsd: number; capability: string; }
export async function provisionCatalog(): Promise<unknown> {
  const res = await fetch(new URL("/api/catalog", config.proxyUrl));
  if (!res.ok) throw new Error(`/api/catalog failed: ${res.status}`);
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
  const res = await fetch(new URL(`/api/provision/${encodeURIComponent(jobId)}`, config.proxyUrl), { headers: { "x-resource-capability": capability } });
  if (!res.ok) throw new Error(`Provision status failed (${res.status})`);
  return res.json();
}
export async function provisionDelete(jobId: string, capability: string): Promise<unknown> {
  const res = await fetch(new URL(`/api/provision/${encodeURIComponent(jobId)}`, config.proxyUrl), { method: "DELETE", headers: { "x-resource-capability": capability } });
  if (!res.ok) throw new Error(`Provision delete failed (${res.status}): ${await res.text()}`);
  return res.json();
}
