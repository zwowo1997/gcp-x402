import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, createV3MandateDraft, createV3TradingQuotePayload, hashMandatePayload, normalizeV3PaperStrategy, simulateV3Deployment, simulatedV3Telemetry, v3Quote, v3ResourceBreakdown, verifyV3TradingQuotePayload } from "../src/v3-contracts.js";
import { paymentProviderInfo } from "../src/payment-provider.js";

test("v3 quotes are duration-aware, capped, and charge only the expected final amount", () => {
  assert.deepEqual(v3Quote("trading.paper.ema", 15), {
    productId: "trading.paper.ema", durationMinutes: 15, estimatedGcpUsd: 0.029271, serviceFeeUsd: 0.060729,
    expectedChargeUsd: 0.09, authorizationCapUsd: 0.15, currency: "USDC", settlement: "provision-then-settle", unusedAuthorization: "never-transferred",
  });
  assert.equal(v3Quote("vm.small", 30).expectedChargeUsd, 0.2);
  assert.equal(v3Quote("storage.small", 60).expectedChargeUsd, 0.17);
  assert.equal(v3Quote("trading.paper.ema", 60).expectedChargeUsd, 0.19);
});

test("real V3 trading quote binds duration, strategy, payer, resources, and expiry", () => {
  const now = new Date("2026-08-05T12:00:00.000Z");
  const payload = createV3TradingQuotePayload({
    durationMinutes: 30,
    payer: "0x1111111111111111111111111111111111111111",
    payTo: "0x2222222222222222222222222222222222222222",
    asset: "0x3333333333333333333333333333333333333333",
    strategy: { fastEma: 7, slowEma: 25 },
    requestId: "request-1",
    quoteId: "quote-1",
    now,
  });
  assert.equal(payload.quote.durationMinutes, 30);
  assert.equal(payload.quote.expectedChargeUsd, 0.12);
  assert.equal(payload.quote.authorizationCapUsd, 0.25);
  assert.equal(payload.strategy.fastEma, 7);
  assert.equal(payload.expiresAt, "2026-08-05T12:10:00.000Z");
  assert.equal(payload.resources.reduce((sum, item) => sum + item.estimatedUsd, 0), payload.quote.estimatedGcpUsd);
  assert.equal(verifyV3TradingQuotePayload(payload, new Date("2026-08-05T12:09:59.000Z")), true);
  assert.equal(verifyV3TradingQuotePayload(payload, new Date("2026-08-05T12:10:00.000Z")), false);
  assert.equal(verifyV3TradingQuotePayload({ ...payload, payer: "0x4444444444444444444444444444444444444444" }, now), false);
});

test("real V3 strategy normalization rejects unsafe or inconsistent limits", () => {
  assert.equal(normalizeV3PaperStrategy().symbol, "BTC");
  assert.throws(() => normalizeV3PaperStrategy({ fastEma: 21, slowEma: 9 }), /slowEma/);
  assert.throws(() => normalizeV3PaperStrategy({ maxOrderNotionalUsd: 3_000, maxPositionNotionalUsd: 2_000 }), /cannot exceed/);
});

test("payment provider boundary does not claim Base Sepolia MoonPay support", () => {
  const moonpay = paymentProviderInfo("moonpay-test");
  assert.equal(moonpay.checkout, "moonpay-hosted");
  assert.equal(moonpay.supportsBaseSepolia, false);
  assert.match(moonpay.note, /not Base Sepolia/i);
  assert.equal(paymentProviderInfo("anything-else").id, "simulator");
});

test("v3 paper telemetry is deterministic, visible, and never executable", () => {
  const first = simulatedV3Telemetry("sim-test", "2026-08-03T12:00:00.000Z");
  const second = simulatedV3Telemetry("sim-test", "2026-08-03T12:00:00.000Z");
  assert.deepEqual(first, second);
  assert.equal(first.market.length, 24);
  assert.equal(first.strategy.signal, "short_hedge");
  assert.ok(first.orders.every((order) => order.status === "simulated_fill"));
});

test("v3 mandate binds every payment-critical field and has a ten-minute expiry", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");
  const mandate = createV3MandateDraft({
    payer: "0x1111111111111111111111111111111111111111", payTo: "0x2222222222222222222222222222222222222222",
    asset: "usdc", quote: v3Quote("vm.small", 15), now, requestId: "request-1", mandateId: "mandate-1", nonce: "nonce-1",
  });
  assert.equal(mandate.version, "gcp-x402-ap2-evm-1");
  assert.equal(mandate.payer, "0x1111111111111111111111111111111111111111");
  assert.equal(mandate.expiresAt, "2026-08-03T12:10:00.000Z");
  assert.equal(mandate.status, "draft");
  assert.match(mandate.requestHash, /^[a-f0-9]{64}$/);
  const unsigned = ({ requestHash: _hash, status: _status, disclaimer: _disclaimer, ...value }) => value;
  const changedQuote = { ...unsigned(mandate), quote: v3Quote("storage.small", 60) };
  const changedAsset = { ...unsigned(mandate), asset: "other-usdc" };
  const changedNetwork = { ...unsigned(mandate), network: "base" as const };
  const changedExpiry = { ...unsigned(mandate), expiresAt: "2026-08-03T12:11:00.000Z" };
  assert.notEqual(hashMandatePayload(changedQuote), mandate.requestHash);
  assert.notEqual(hashMandatePayload(changedAsset), mandate.requestHash);
  assert.notEqual(hashMandatePayload(changedNetwork), mandate.requestHash);
  assert.notEqual(hashMandatePayload(changedExpiry), mandate.requestHash);
  assert.match(canonicalJson({ quote: changedQuote.quote }), /storage.small/);
});

test("v3 resource rows are prorated and exactly reconcile to the quote", () => {
  for (const durationMinutes of [15, 30, 60] as const) {
    const quote = v3Quote("trading.paper.ema", durationMinutes);
    const resources = v3ResourceBreakdown(quote);
    assert.equal(resources.some((resource) => resource.service === "Cloud Tasks"), true);
    const total = Math.round(resources.reduce((sum, resource) => sum + resource.estimatedUsd, 0) * 1_000_000) / 1_000_000;
    assert.equal(total, quote.estimatedGcpUsd);
  }
});

test("v3 simulator is explicitly non-financial and non-provisioning", () => {
  const simulation = simulateV3Deployment({
    productId: "trading.paper.ema", durationMinutes: 15,
    payTo: "0x2222222222222222222222222222222222222222", asset: "usdc",
  });
  assert.equal(simulation.simulation, true);
  assert.match(simulation.warning, /no money transferred/i);
  assert.equal(simulation.onramp.provider, "coinbase-sandbox");
  assert.match(simulation.embeddedWallet.address, /^0x[0-9a-f]{40}$/);
  assert.equal(simulation.status, "checkout");
  assert.equal(simulation.paymentStatus, "not_authorized");
  assert.equal(simulation.resources.some((resource) => resource.service === "Spanner"), true);
  assert.match(simulation.timeline.at(-1)?.detail ?? "", /no wallet, card, KYC record, payment, or cloud resource/i);
});
