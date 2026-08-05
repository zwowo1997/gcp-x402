import { type V3TradingQuotePayload, verifyV3TradingQuotePayload } from "../v3";

export function usdToUsdcBaseUnits(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error("Payment amount must be positive.");
  const units = Math.round(amountUsd * 1_000_000);
  if (Math.abs(units / 1_000_000 - amountUsd) > Number.EPSILON * 10) throw new Error("Payment amount exceeds USDC precision.");
  return String(units);
}

export function validateV3ExactSettlement(payload: V3TradingQuotePayload, verifiedPayer: string, operatorHardCeilingUsd: number, now = new Date()): string {
  if (!verifyV3TradingQuotePayload(payload, now)) throw new Error("Trading quote is invalid, modified, or expired.");
  if (verifiedPayer.toLowerCase() !== payload.payer) throw new Error("Verified payment payer does not match the quoted payer.");
  if (payload.quote.expectedChargeUsd > payload.quote.authorizationCapUsd) throw new Error("Expected charge exceeds the authorized maximum.");
  if (payload.quote.authorizationCapUsd > operatorHardCeilingUsd) throw new Error("Authorization exceeds the operator hard ceiling.");
  return usdToUsdcBaseUnits(payload.quote.expectedChargeUsd);
}
