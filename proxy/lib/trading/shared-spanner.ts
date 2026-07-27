import { type TradingResources } from "./types";

export const sharedTradingSchema = [
  "CREATE TABLE MarketSnapshots (TenantId STRING(64) NOT NULL, event_id STRING(64) NOT NULL, observed_at TIMESTAMP NOT NULL, symbol STRING(16) NOT NULL, mid FLOAT64, raw_json STRING(MAX), commit_ts TIMESTAMP OPTIONS (allow_commit_timestamp=true)) PRIMARY KEY (TenantId, event_id)",
  "CREATE INDEX MarketSnapshotsByTenantTime ON MarketSnapshots(TenantId, observed_at DESC)",
  "CREATE TABLE StrategyState (TenantId STRING(64) NOT NULL, state_key STRING(64) NOT NULL, updated_at TIMESTAMP NOT NULL, payload STRING(MAX)) PRIMARY KEY (TenantId, state_key)",
  "CREATE TABLE SimulatedOrders (TenantId STRING(64) NOT NULL, order_id STRING(64) NOT NULL, created_at TIMESTAMP NOT NULL, side STRING(8) NOT NULL, quantity FLOAT64, price FLOAT64, status STRING(24), payload STRING(MAX)) PRIMARY KEY (TenantId, order_id)",
  "CREATE INDEX SimulatedOrdersByTenantTime ON SimulatedOrders(TenantId, created_at DESC)",
];

/** Delete every row owned by one renter without touching another tenant or the shared database. */
export function tenantDeleteMutations(resources: TradingResources) {
  const start = { values: [{ stringValue: resources.tenantId }] };
  const end = { values: [{ stringValue: `${resources.tenantId}\uffff` }] };
  return ["MarketSnapshots", "StrategyState", "SimulatedOrders"].map((table) => ({
    delete: { table, keySet: { ranges: [{ startClosed: start, endOpen: end }] } },
  }));
}
