import assert from "node:assert/strict";
import test from "node:test";
import { createV3MandateDraft, simulateV3Deployment, v3Quote } from "../src/v3-contracts.js";

test("v3 quotes are duration-aware, capped, and charge only the expected final amount", () => {
  assert.deepEqual(v3Quote("trading.paper.ema", 15), {
    productId: "trading.paper.ema", durationMinutes: 15, estimatedGcpUsd: 0.028521, serviceFeeUsd: 0.06,
    expectedChargeUsd: 0.09, authorizationCapUsd: 1.25, currency: "USDC", settlement: "provision-then-settle", unusedAuthorization: "never-transferred",
  });
  assert.equal(v3Quote("vm.small", 30).expectedChargeUsd, 0.2);
  assert.equal(v3Quote("storage.small", 60).expectedChargeUsd, 0.17);
  assert.equal(v3Quote("trading.paper.ema", 60).expectedChargeUsd, 0.19);
});

test("v3 mandate binds a concrete payer, quote, and ten-minute expiry", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");
  const mandate = createV3MandateDraft({
    payer: "0x1111111111111111111111111111111111111111", payTo: "0x2222222222222222222222222222222222222222",
    asset: "usdc", quote: v3Quote("vm.small", 15), now, requestId: "request-1",
  });
  assert.equal(mandate.version, "gcp-x402-ap2-evm-1");
  assert.equal(mandate.payer, "0x1111111111111111111111111111111111111111");
  assert.equal(mandate.expiresAt, "2026-08-03T12:10:00.000Z");
  assert.equal(mandate.status, "draft");
  assert.match(mandate.requestHash, /^[a-f0-9]{64}$/);
});

test("v3 simulator is explicitly non-financial and non-provisioning", () => {
  const simulation = simulateV3Deployment({
    productId: "trading.paper.ema", durationMinutes: 15,
    payer: "0x1111111111111111111111111111111111111111", payTo: "0x2222222222222222222222222222222222222222", asset: "usdc",
  });
  assert.equal(simulation.simulation, true);
  assert.match(simulation.warning, /no money transferred/i);
  assert.equal(simulation.onramp.provider, "coinbase-sandbox");
  assert.equal(simulation.resources.some((resource) => resource.service === "Spanner"), true);
  assert.match(simulation.timeline.at(-1)?.detail ?? "", /No Cloud resources/);
});
