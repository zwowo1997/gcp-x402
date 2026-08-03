import { NextRequest, NextResponse } from "next/server";
import { isV3Duration, simulateV3Deployment, type V3ProductId } from "../../../../lib/v3";
import { config } from "../../../../lib/config";
import { requireBetaSession, BETA_SESSION_HEADER } from "../../../../lib/beta";
import { limitV3Simulation, saveV3Simulation } from "../../../../lib/v3-store";

export const dynamic = "force-dynamic";
const products = new Set<V3ProductId>(["trading.paper.ema", "vm.small", "storage.small"]);

export async function POST(request: NextRequest) {
  // This route remains a dry-run even if somebody accidentally sets the future flag.
  // There is no settlement or provisioning implementation behind /api/v3 in beta.
  if (config.v3RealSettlementEnabled) {
    return NextResponse.json({ error: "V3 real settlement is not implemented in this beta build; disable V3_REAL_SETTLEMENT_ENABLED." }, { status: 503 });
  }
  const locked = requireBetaSession(request); if (locked) return locked;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productId = body?.productId;
  const durationMinutes = Number(body?.durationMinutes);
  if (typeof productId !== "string" || !products.has(productId as V3ProductId) || !isV3Duration(durationMinutes)) {
    return NextResponse.json({ error: "Expected an allowlisted productId and durationMinutes (15, 30, or 60)." }, { status: 400 });
  }
  try {
    limitV3Simulation(request.headers.get(BETA_SESSION_HEADER));
    const session = request.headers.get(BETA_SESSION_HEADER);
    const simulation = await saveV3Simulation(simulateV3Deployment({ productId: productId as V3ProductId, durationMinutes, payTo: config.payTo, network: config.network.id, asset: config.network.usdcAddress }), session);
    return NextResponse.json(simulation, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create simulation." }, { status: 400 });
  }
}
