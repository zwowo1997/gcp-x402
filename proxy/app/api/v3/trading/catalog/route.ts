import { NextRequest, NextResponse } from "next/server";
import { requireBetaSession } from "@/lib/beta";
import { config } from "@/lib/config";
import { V3_DURATIONS, v3Quote, v3ResourceBreakdown } from "@/lib/v3";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const locked = requireBetaSession(req); if (locked) return locked;
  return NextResponse.json({
    profileId: "trading.paper.ema",
    mode: "paper-only",
    region: config.tradingRegion,
    durationsMinutes: V3_DURATIONS,
    plans: V3_DURATIONS.map((durationMinutes) => {
      const quote = v3Quote("trading.paper.ema", durationMinutes);
      return { durationMinutes, quote, resources: v3ResourceBreakdown(quote) };
    }),
    deploymentEnabled: config.v3TestnetDeploymentEnabled,
    operatorHardCeilingUsd: config.maxGcpCostPerProvisionUsd,
    safety: config.v3TestnetDeploymentEnabled ? "Base Sepolia testnet deployment is enabled; every stack remains paper-only." : "Quote preview only. No payment, GCP resource, or trade can be created while deployment is disabled.",
  }, { headers: { "cache-control": "no-store" } });
}
