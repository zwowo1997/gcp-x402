import { NextResponse } from "next/server";
import { CATALOG } from "@/lib/catalog";
import { config } from "@/lib/config";

export function GET() {
  return NextResponse.json({ service: "gcp-x402", network: config.network.id, asset: "USDC", resources: Object.values(CATALOG), limits: { maxGcpCostPerProvisionUsd: config.maxGcpCostPerProvisionUsd, maxOutstandingGcpExposureUsd: config.maxOutstandingGcpExposureUsd } });
}
