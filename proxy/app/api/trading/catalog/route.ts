import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { PAPER_TRADING_PROFILE } from "@/lib/trading/catalog";
import { requireBetaSession } from "@/lib/beta";

export async function GET(req: NextRequest) {
  const locked = requireBetaSession(req);
  if (locked) return locked;
  return NextResponse.json({
    service: "gcp-x402-hyperliquid",
    mode: "paper-only",
    execution: { enabled: false, reason: "Testing release simulates all orders and never stores trading keys or calls the exchange endpoint." },
    region: config.tradingRegion,
    profile: PAPER_TRADING_PROFILE,
    dashboard: { provider: "Firebase Hosting", configured: Boolean(config.tradingDashboardUrl) },
  });
}
