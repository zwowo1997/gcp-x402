// Minimal, facilitator-agnostic x402 server helpers.
//
// We speak the wire protocol directly (the 402 body shape + the facilitator's
// /verify and /settle REST endpoints) rather than pinning to one SDK, so the
// proxy works against the Coinbase facilitator, the x402.org public
// facilitator, or any compatible one via FACILITATOR_URL.
//
// Spec: https://github.com/coinbase/x402/blob/main/specs/x402-specification.md

import { config } from "./config";

export const X402_VERSION = 1;

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  maxAmountRequired: string; // token base units
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: unknown;
  extra: Record<string, unknown>;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: unknown; // scheme-specific (exact: { signature, authorization })
}

/** Build the `exact`-scheme requirement that prices one query. */
export function buildRequirements(args: {
  maxAmountRequired: string;
  resource: string;
  description: string;
  /** Signed quote token, surfaced so the client can display the cost. */
  quoteToken: string;
  /** Long-running provisioning needs a wider authorization window than queries. */
  maxTimeoutSeconds?: number;
}): PaymentRequirements {
  const net = config.network;
  return {
    scheme: "exact",
    network: net.id,
    maxAmountRequired: args.maxAmountRequired,
    resource: args.resource,
    description: args.description,
    mimeType: "application/json",
    payTo: config.payTo,
    maxTimeoutSeconds: args.maxTimeoutSeconds ?? config.quoteTtlSeconds,
    asset: net.usdcAddress,
    extra: {
      // EIP-712 domain the client needs to sign the USDC authorization.
      name: net.eip712.name,
      version: net.eip712.version,
      // Our receipt — not part of the x402 spec, ignored by stock clients.
      quote: args.quoteToken,
    },
  };
}

/** The JSON body of a 402 response. */
export function paymentRequiredBody(requirements: PaymentRequirements, error?: string) {
  return { x402Version: X402_VERSION, accepts: [requirements], error: error ?? null };
}

/** Decode the base64 X-PAYMENT header into a PaymentPayload. */
export function decodePaymentHeader(header: string): PaymentPayload {
  const json = Buffer.from(header, "base64").toString("utf8");
  return JSON.parse(json) as PaymentPayload;
}

interface FacilitatorVerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

interface FacilitatorSettleResponse {
  success: boolean;
  errorReason?: string;
  transaction?: string;
  network?: string;
  payer?: string;
}

function facilitatorHeaders(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (config.facilitatorApiKey) h.authorization = `Bearer ${config.facilitatorApiKey}`;
  return h;
}

async function facilitatorPost<T>(path: string, payment: PaymentPayload, requirements: PaymentRequirements): Promise<T> {
  const res = await fetch(`${config.facilitatorUrl}${path}`, {
    method: "POST",
    headers: facilitatorHeaders(),
    body: JSON.stringify({
      x402Version: X402_VERSION,
      paymentPayload: payment,
      paymentRequirements: requirements,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Facilitator ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

/** Ask the facilitator whether the payment is valid for these requirements. */
export function verify(payment: PaymentPayload, requirements: PaymentRequirements) {
  return facilitatorPost<FacilitatorVerifyResponse>("/verify", payment, requirements);
}

/** Settle the payment onchain. Call this only after the query has succeeded. */
export function settle(payment: PaymentPayload, requirements: PaymentRequirements) {
  return facilitatorPost<FacilitatorSettleResponse>("/settle", payment, requirements);
}

/** Encode the X-PAYMENT-RESPONSE header value from a settle result. */
export function encodeSettlementHeader(settlement: FacilitatorSettleResponse): string {
  return Buffer.from(JSON.stringify(settlement), "utf8").toString("base64");
}
