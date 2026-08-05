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
    deploymentEnabled: false,
    operatorHardCeilingUsd: config.maxGcpCostPerProvisionUsd,
    safety: "Quote preview only in this increment. No payment, GCP resource, or trade can be created from this endpoint.",
  }, { headers: { "cache-control": "no-store" } });
}
