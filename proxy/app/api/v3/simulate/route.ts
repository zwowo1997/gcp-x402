import { NextResponse } from "next/server";
import { isV3Duration, simulateV3Deployment, type V3ProductId } from "../../../../lib/v3";
import { config } from "../../../../lib/config";

export const dynamic = "force-dynamic";
const products = new Set<V3ProductId>(["trading.paper.ema", "vm.small", "storage.small"]);

export async function POST(request: Request) {
  // This route remains a dry-run even if somebody accidentally sets the future flag.
  // There is no settlement or provisioning implementation behind /api/v3 in beta.
  if (config.v3RealSettlementEnabled) {
    return NextResponse.json({ error: "V3 real settlement is not implemented in this beta build; disable V3_REAL_SETTLEMENT_ENABLED." }, { status: 503 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productId = body?.productId;
  const durationMinutes = Number(body?.durationMinutes);
  const payer = body?.payer;
  if (typeof productId !== "string" || !products.has(productId as V3ProductId) || !isV3Duration(durationMinutes) || typeof payer !== "string") {
    return NextResponse.json({ error: "Expected an allowlisted productId, durationMinutes (15, 30, or 60), and EVM payer address." }, { status: 400 });
  }
  const payTo = process.env.PAY_TO_ADDRESS ?? "0x0000000000000000000000000000000000000000";
  const asset = process.env.X402_NETWORK === "base" ? "base-usdc-config-required" : "base-sepolia-usdc-config-required";
  try {
    return NextResponse.json(simulateV3Deployment({ productId: productId as V3ProductId, durationMinutes, payer, payTo, asset }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create simulation." }, { status: 400 });
  }
}
