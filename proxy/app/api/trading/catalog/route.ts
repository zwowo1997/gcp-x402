import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { PAPER_TRADING_PROFILE } from "@/lib/trading/catalog";
import { requireBetaSession } from "@/lib/beta";
import { tradingCostBreakdown, tradingCostSummary } from "@/lib/trading/costs";
import { tradingResources } from "@/lib/trading/provisioning";

export async function GET(req: NextRequest) {
  const locked = requireBetaSession(req);
  if (locked) return locked;
  const exampleResources = tradingResources("example-tenant");
  return NextResponse.json({
    service: "gcp-x402-hyperliquid",
    mode: "paper-only",
    execution: { enabled: false, reason: "Testing release simulates all orders and never stores trading keys or calls the exchange endpoint." },
    region: config.tradingRegion,
    profile: PAPER_TRADING_PROFILE,
    estimatedResources: tradingCostBreakdown(exampleResources),
    costSummary: tradingCostSummary(exampleResources),
    dashboard: { provider: "Firebase Hosting", configured: Boolean(config.tradingDashboardUrl) },
  });
}
