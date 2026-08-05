import assert from "node:assert/strict";
import test from "node:test";
import { type TradingResources } from "../proxy/lib/trading/types.js";

const resources: TradingResources = {
  collectorService: "hl-feed-demo", writerService: "hl-writer-demo", strategyService: "hl-paper-demo",
  topic: "hl-market-demo", persistSubscription: "hl-persist-demo", strategySubscription: "hl-strategy-demo",
  tenantId: "tenant-demo", database: "hyperliquid-demo",
};

test("cost visibility lists every GCP product used by the stack", async () => {
  process.env.GCP_PROJECT_ID ||= "test-project";
  process.env.PAY_TO_ADDRESS ||= "0x0000000000000000000000000000000000000000";
  process.env.QUOTE_SECRET ||= "test-secret";
  const { reconcileV3TradingEstimate, tradingCostBreakdown, tradingCostSummary } = await import("../proxy/lib/trading/costs.js");
  const breakdown = tradingCostBreakdown(resources);
  const services = new Set(breakdown.map((item) => item.service));
  assert.deepEqual([...services], ["Cloud Run", "Pub/Sub", "Spanner", "Firebase Hosting", "Cloud Tasks"]);
  assert.ok(breakdown.every((item) => item.estimatedLeaseUsd >= 0));
  const summary = tradingCostSummary(resources);
  assert.equal(summary.x402PaymentUsd, 5);
  assert.equal(summary.estimatedGcpUsageUsd, 0.114083);
  assert.match(summary.estimateBasis, /60-minute GCP allocation/);
  assert.ok(summary.estimatedGcpUsageUsd > 0 && summary.estimatedGcpUsageUsd < summary.x402PaymentUsd);
  for (const durationMinutes of [15, 30, 60] as const) {
    assert.equal(reconcileV3TradingEstimate(resources, durationMinutes), true);
    const quoted = tradingCostSummary(resources, durationMinutes, durationMinutes === 15 ? 0.09 : durationMinutes === 30 ? 0.12 : 0.19);
    assert.match(quoted.estimateBasis, new RegExp(`${durationMinutes}-minute`));
    assert.ok(quoted.x402PaymentUsd < 5);
  }
});

test("paper trading catalog advertises a one-hour lease", async () => {
  const { PAPER_TRADING_PROFILE } = await import("../proxy/lib/trading/catalog.js");
  assert.equal(PAPER_TRADING_PROFILE.durationHours, 1);
});
