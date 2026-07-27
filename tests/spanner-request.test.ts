import assert from "node:assert/strict";
import test from "node:test";
import { sharedTradingSchema, tenantDeleteMutations } from "../proxy/lib/trading/shared-spanner.js";
import { type TradingResources } from "../proxy/lib/trading/types.js";

test("shared Spanner tables lead with TenantId in every primary key", () => {
  const tables = sharedTradingSchema.filter((statement) => statement.startsWith("CREATE TABLE"));
  assert.equal(tables.length, 3);
  assert.ok(tables.every((statement) => statement.includes("PRIMARY KEY (TenantId,")));
});

test("tenant cleanup is restricted to one tenant key range", () => {
  const resources: TradingResources = {
    tenantId: "b3e07871-9c35-4d7a-b0bc-123456789abc",
    database: "hyperliquid-demo",
    collectorService: "collector",
    writerService: "writer",
    strategyService: "strategy",
    topic: "topic",
    persistSubscription: "persist",
    strategySubscription: "strategy-sub",
  };
  const mutations = tenantDeleteMutations(resources);
  assert.equal(mutations.length, 3);
  assert.ok(mutations.every(({ delete: operation }) =>
    operation.keySet.ranges[0].startClosed[0] === resources.tenantId
    && operation.keySet.ranges[0].endClosed[0] === resources.tenantId
  ));
});
