import assert from "node:assert/strict";
import test from "node:test";
import { createV3TradingQuotePayload } from "../src/v3-contracts.js";
import { usdToUsdcBaseUnits, validateV3ExactSettlement } from "../proxy/lib/trading/v3-payment.js";

const payer = "0x1111111111111111111111111111111111111111";
const payload = createV3TradingQuotePayload({
  durationMinutes: 15, payer,
  payTo: "0x2222222222222222222222222222222222222222",
  asset: "0x3333333333333333333333333333333333333333",
  now: new Date("2026-08-05T12:00:00.000Z"),
});

test("V3 exact bridge settles expected charge rather than authorization cap", () => {
  assert.equal(payload.quote.expectedChargeUsd, 0.09);
  assert.equal(payload.quote.authorizationCapUsd, 0.15);
  assert.equal(validateV3ExactSettlement(payload, payer.toUpperCase(), 5, new Date("2026-08-05T12:01:00.000Z")), "90000");
  assert.notEqual(usdToUsdcBaseUnits(payload.quote.authorizationCapUsd), "90000");
});

test("V3 exact bridge rejects payer mismatch, quote tampering, expiry, and ceiling violations", () => {
  const now = new Date("2026-08-05T12:01:00.000Z");
  assert.throws(() => validateV3ExactSettlement(payload, "0x4444444444444444444444444444444444444444", 5, now), /payer/);
  assert.throws(() => validateV3ExactSettlement({ ...payload, quote: { ...payload.quote, expectedChargeUsd: 0.08 } }, payer, 5, now), /invalid, modified, or expired/);
  assert.throws(() => validateV3ExactSettlement(payload, payer, 0.1, now), /hard ceiling/);
  assert.throws(() => validateV3ExactSettlement(payload, payer, 5, new Date("2026-08-05T12:10:00.000Z")), /expired/);
});
