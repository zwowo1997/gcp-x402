export type TradingStackStatus = "payment_pending" | "provisioning" | "running" | "stopped" | "expired" | "shutdown" | "failed";
export type TradingControl = "start" | "stop" | "resume" | "shutdown";

export interface PaperStrategyConfig {
  symbol: "BTC";
  fastEma: number;
  slowEma: number;
  evaluationIntervalSeconds: 60;
  virtualBalanceUsd: number;
  maxOrderNotionalUsd: number;
  maxPositionNotionalUsd: number;
  maxDailyLossUsd: number;
  slippageBps: number;
}

export interface TradingResources {
  collectorService: string;
  writerService: string;
  strategyService: string;
  topic: string;
  persistSubscription: string;
  strategySubscription: string;
  tenantId: string;
  database: string;
}

export interface TradingCostEstimate {
  service: "Cloud Run" | "Pub/Sub" | "Spanner" | "Firebase Hosting" | "Cloud Tasks";
  component: string;
  resource: string;
  region: string;
  scope: "dedicated" | "shared";
  estimatedLeaseUsd: number;
  note: string;
}

export interface TradingCostSummary {
  x402PaymentUsd: number;
  estimatedGcpUsageUsd: number;
  serviceAndRiskBufferUsd: number;
  estimateBasis: string;
}

export interface TradingStackRecord {
  id: string;
  payer: string;
  requestKey?: string;
  profileId: "trading.paper.ema";
  status: TradingStackStatus;
  mode: "paper";
  config: PaperStrategyConfig;
  resources: TradingResources;
  maxGcpCostUsd: number;
  /** Legacy V2 records omit this and are interpreted using TRADING_LEASE_HOURS. */
  durationMinutes?: 15 | 30 | 60;
  quoteId?: string;
  expectedChargeUsd?: number;
  authorizationCapUsd?: number;
  settledAmountUsd: number;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  error?: string;
}

export interface TradingEvent {
  id: string;
  stackId: string;
  type: "provisioned" | "started" | "stopped" | "resumed" | "shutdown" | "expired" | "failed";
  message: string;
  createdAt: string;
}
