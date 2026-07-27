import { NextRequest, NextResponse } from "next/server";
import { CATALOG } from "@/lib/catalog";
import { config } from "@/lib/config";
import { requireBetaSession } from "@/lib/beta";

export function GET(req: NextRequest) {
  const locked = requireBetaSession(req);
  if (locked) return locked;
  return NextResponse.json({ service: "gcp-x402", network: config.network.id, asset: "USDC", resources: Object.values(CATALOG), limits: { maxGcpCostPerProvisionUsd: config.maxGcpCostPerProvisionUsd, maxOutstandingGcpExposureUsd: config.maxOutstandingGcpExposureUsd } });
}
