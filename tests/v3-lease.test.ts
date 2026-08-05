import assert from "node:assert/strict";
import test from "node:test";

process.env.GCP_PROJECT_ID ||= "test-project";
process.env.PAY_TO_ADDRESS ||= "0x0000000000000000000000000000000000000000";
process.env.QUOTE_SECRET ||= "test-secret";

test("V3 lease record derives duration, expiry, price, and strategy only from a verified quote", async () => {
  const { createV3TradingQuotePayload } = await import("../src/v3-contracts.js");
  const { tradingStackFromV3Quote } = await import("../proxy/lib/trading/v3-lease.js");
  const issued = new Date("2026-08-05T12:00:00.000Z");
  const provisioned = new Date("2026-08-05T12:02:00.000Z");
  const payload = createV3TradingQuotePayload({
    durationMinutes: 15,
    payer: "0x1111111111111111111111111111111111111111",
    payTo: "0x2222222222222222222222222222222222222222",
    asset: "0x3333333333333333333333333333333333333333",
    strategy: { fastEma: 5, slowEma: 18 },
    requestId: "request-lease-1",
    quoteId: "quote-lease-1",
    now: issued,
  });
  const stack = tradingStackFromV3Quote(payload, provisioned, "stack-1");
  assert.equal(stack.durationMinutes, 15);
  assert.equal(stack.expiresAt, "2026-08-05T12:17:00.000Z");
  assert.equal(stack.expectedChargeUsd, 0.09);
  assert.equal(stack.authorizationCapUsd, 0.15);
  assert.equal(stack.config.fastEma, 5);
  assert.equal(stack.maxGcpCostUsd, 5);
  assert.throws(() => tradingStackFromV3Quote({ ...payload, durationMinutes: 60 } as never, provisioned), /invalid, modified, or expired/);
});
