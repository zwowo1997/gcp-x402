import { randomUUID } from "node:crypto";
import { config } from "../config";
import { type V3TradingQuotePayload, verifyV3TradingQuotePayload } from "../v3";
import { tradingResources } from "./provisioning";
import { type TradingStackRecord } from "./types";

export function v3LeaseExpiry(now: Date, durationMinutes: 15 | 30 | 60): Date {
  return new Date(now.getTime() + durationMinutes * 60_000);
}

/** Build a reservation record only from a verified quote; this function performs no I/O. */
export function tradingStackFromV3Quote(payload: V3TradingQuotePayload, now = new Date(), stackId = randomUUID()): TradingStackRecord {
  if (!verifyV3TradingQuotePayload(payload, now)) throw new Error("Trading quote is invalid, modified, or expired.");
  if (payload.network !== "base-sepolia" || payload.profileId !== "trading.paper.ema") throw new Error("Only Base Sepolia paper trading quotes are accepted.");
  const durationMinutes = payload.quote.durationMinutes;
  const expiresAt = v3LeaseExpiry(now, durationMinutes);
  return {
    id: stackId,
    payer: payload.payer,
    requestKey: payload.requestId,
    profileId: payload.profileId,
    status: "payment_pending",
    mode: "paper",
    config: payload.strategy,
    resources: tradingResources(stackId),
    // Preserve the conservative operator exposure reservation independently of user price.
    maxGcpCostUsd: config.maxGcpCostPerProvisionUsd,
    durationMinutes,
    quoteId: payload.quoteId,
    expectedChargeUsd: payload.quote.expectedChargeUsd,
    authorizationCapUsd: payload.quote.authorizationCapUsd,
    settledAmountUsd: 0,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    updatedAt: now.toISOString(),
  };
}
