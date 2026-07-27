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
  const { tradingCostBreakdown, tradingCostSummary } = await import("../proxy/lib/trading/costs.js");
  const services = new Set(tradingCostBreakdown(resources).map((item) => item.service));
  assert.deepEqual([...services], ["Cloud Run", "Pub/Sub", "Spanner", "Firebase Hosting", "Cloud Tasks"]);
  const summary = tradingCostSummary(resources);
  assert.equal(summary.x402PaymentUsd, 5);
  assert.ok(summary.estimatedGcpUsageUsd > 0 && summary.estimatedGcpUsageUsd < summary.x402PaymentUsd);
});
