import assert from "node:assert/strict";
import test from "node:test";
import { createV3TradingQuotePayload } from "../src/v3-contracts.js";
import { signV3TradingQuote, verifyV3TradingQuoteToken } from "../proxy/lib/trading/v3-quote-token.js";

const now = new Date("2026-08-05T12:00:00.000Z");
const payload = createV3TradingQuotePayload({
  durationMinutes: 15,
  payer: "0x1111111111111111111111111111111111111111",
  payTo: "0x2222222222222222222222222222222222222222",
  asset: "0x3333333333333333333333333333333333333333",
  requestId: "request-1",
  quoteId: "quote-1",
  now,
});

test("V3 trading quote token is authenticated and expires", () => {
  const token = signV3TradingQuote(payload, "test-secret");
  assert.deepEqual(verifyV3TradingQuoteToken(token, "test-secret", new Date("2026-08-05T12:09:00.000Z")), payload);
  assert.equal(verifyV3TradingQuoteToken(`${token.slice(0, -1)}x`, "test-secret", now), null);
  assert.equal(verifyV3TradingQuoteToken(token, "wrong-secret", now), null);
  assert.equal(verifyV3TradingQuoteToken(token, "test-secret", new Date("2026-08-05T12:10:00.000Z")), null);
});
