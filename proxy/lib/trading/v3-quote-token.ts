import { createHmac, timingSafeEqual } from "node:crypto";
import { type V3TradingQuotePayload, verifyV3TradingQuotePayload } from "../v3";

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signV3TradingQuote(payload: V3TradingQuotePayload, secret: string): string {
  if (!secret) throw new Error("Quote signing secret is required.");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

/** Authenticate the signed payload for idempotent recovery, even after quote expiry. */
export function authenticateV3TradingQuoteToken(token: string, secret: string): V3TradingQuotePayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1 || !secret) return null;
  const body = token.slice(0, dot);
  const supplied = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(body, secret));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as V3TradingQuotePayload;
    const { requestHash, ...unsigned } = payload;
    const structuralNow = new Date(new Date(payload.expiresAt).getTime() - 1);
    return requestHash && verifyV3TradingQuotePayload({ ...unsigned, requestHash }, structuralNow) ? payload : null;
  } catch {
    return null;
  }
}

export function verifyV3TradingQuoteToken(token: string, secret: string, now = new Date()): V3TradingQuotePayload | null {
  const payload = authenticateV3TradingQuoteToken(token, secret);
  return payload && verifyV3TradingQuotePayload(payload, now) ? payload : null;
}
