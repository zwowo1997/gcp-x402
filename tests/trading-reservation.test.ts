import assert from "node:assert/strict";
import test from "node:test";
import { reserveTradingStack } from "../proxy/lib/trading/store.js";
import { type TradingStackRecord } from "../proxy/lib/trading/types.js";

function stack(id: string, requestKey: string): TradingStackRecord {
  const now = new Date().toISOString();
  return {
    id, requestKey, payer: "0x123", profileId: "trading.paper.ema", status: "payment_pending", mode: "paper",
    config: { symbol: "BTC", fastEma: 9, slowEma: 21, evaluationIntervalSeconds: 60, virtualBalanceUsd: 10_000, maxOrderNotionalUsd: 1_000, maxPositionNotionalUsd: 2_000, maxDailyLossUsd: 500, slippageBps: 5 },
    resources: { collectorService: `collector-${id}`, writerService: `writer-${id}`, strategyService: `strategy-${id}`, topic: `topic-${id}`, persistSubscription: `persist-${id}`, strategySubscription: `strategy-${id}`, tenantId: id, database: "hyperliquid-demo" },
    maxGcpCostUsd: 5, settledAmountUsd: 0, createdAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString(), updatedAt: now,
  };
}

test("the same request key reserves exactly one trading stack", async () => {
  const first = await reserveTradingStack(stack("stack-a", "request-atomic-test"), 20);
  const concurrentRetry = await reserveTradingStack(stack("stack-b", "request-atomic-test"), 20);
  assert.equal(first.created, true);
  assert.equal(concurrentRetry.created, false);
  assert.equal(concurrentRetry.stack.id, "stack-a");
});
