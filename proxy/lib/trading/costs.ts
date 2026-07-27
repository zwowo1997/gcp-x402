import { config } from "../config";
import { PAPER_TRADING_PROFILE } from "./catalog";
import { type TradingCostEstimate, type TradingCostSummary, type TradingResources } from "./types";

const roundUsd = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

/** Illustrative 24-hour allocations for visibility, not itemized x402 charges or a GCP invoice. */
export function tradingCostBreakdown(resources: TradingResources): TradingCostEstimate[] {
  return [
    { service: "Cloud Run", component: "Hyperliquid market-feed collector", resource: resources.collectorService, region: config.tradingRegion, scope: "dedicated", estimated24hUsd: 2.5, note: "Always-on 1 vCPU / 512 MiB demo estimate before free-tier credits." },
    { service: "Cloud Run", component: "Pub/Sub-to-Spanner writer", resource: resources.writerService, region: config.tradingRegion, scope: "dedicated", estimated24hUsd: 0.08, note: "Scale-to-zero request-driven demo estimate." },
    { service: "Cloud Run", component: "Paper EMA strategy", resource: resources.strategyService, region: config.tradingRegion, scope: "dedicated", estimated24hUsd: 0.08, note: "Scale-to-zero request-driven demo estimate." },
    { service: "Pub/Sub", component: "Market topic and two push subscriptions", resource: `${resources.topic} · ${resources.persistSubscription} · ${resources.strategySubscription}`, region: config.tradingRegion, scope: "dedicated", estimated24hUsd: 0.003, note: "Low-volume feed estimate; actual throughput may fall within the monthly free tier." },
    { service: "Spanner", component: "Tenant-isolated market, strategy, and order rows", resource: `${config.tradingSpannerInstance}/${resources.database}/tenant/${resources.tenantId}`, region: "us-central1", scope: "shared", estimated24hUsd: 0.05, note: "Allocated share of the operator-owned instance; not a dedicated instance charge." },
    { service: "Firebase Hosting", component: "Strategy control dashboard", resource: config.tradingDashboardUrl ?? "shared Firebase dashboard", region: "global", scope: "shared", estimated24hUsd: 0.001, note: "Shared static hosting allocation; often covered by no-cost usage." },
    { service: "Cloud Tasks", component: "Automatic 24-hour cleanup", resource: config.tasksQueue ?? "cleanup task", region: config.tasksLocation, scope: "dedicated", estimated24hUsd: 0.001, note: "One scheduled cleanup task allocation." },
  ];
}

export function tradingCostSummary(resources: TradingResources): TradingCostSummary {
  const estimatedGcpUsageUsd = roundUsd(tradingCostBreakdown(resources).reduce((sum, item) => sum + item.estimated24hUsd, 0));
  return {
    x402PaymentUsd: PAPER_TRADING_PROFILE.priceCeilingUsd,
    estimatedGcpUsageUsd,
    serviceAndRiskBufferUsd: roundUsd(Math.max(0, PAPER_TRADING_PROFILE.priceCeilingUsd - estimatedGcpUsageUsd)),
    estimateBasis: "Illustrative 24-hour GCP allocation before free-tier credits; the fixed x402 payment is not itemized billing and is not a refundable deposit.",
  };
}
