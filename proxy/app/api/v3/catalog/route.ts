import { NextRequest, NextResponse } from "next/server";
import { V3_DURATIONS, V3_VERSION, v3Quote, type V3ProductId } from "../../../../lib/v3";
import { requireBetaSession } from "../../../../lib/beta";
import { config } from "../../../../lib/config";

export const dynamic = "force-dynamic";
const products: V3ProductId[] = ["trading.paper.ema", "vm.small", "storage.small"];

export async function GET(req: NextRequest) {
  const locked = requireBetaSession(req); if (locked) return locked;
  return NextResponse.json({
    version: V3_VERSION, mode: "simulation-only", paymentProtocol: "x402-v2-upto (contract preview; settlement disabled)", realSettlementEnabled: config.v3RealSettlementEnabled,
    onramp: "coinbase-sandbox (simulated; no credentials or real funds)",
    durationsMinutes: V3_DURATIONS,
    products: products.map((productId) => ({ productId, quotes: V3_DURATIONS.map((durationMinutes) => v3Quote(productId, durationMinutes)) })),
    safety: ["No cloud resources are created.", "No stablecoin transaction is submitted.", "No Hyperliquid order is submitted.", "KYC is never bypassed; a production onramp may require verification."],
  }, { headers: { "cache-control": "no-store" } });
}
