import { NextRequest, NextResponse } from "next/server";
import { isV3Duration, simulateV3Deployment, type V3ProductId } from "../../../../lib/v3";
import { config } from "../../../../lib/config";
import { requireBetaSession, BETA_SESSION_HEADER } from "../../../../lib/beta";
import { getV3SimulationByRequestId, limitV3Simulation, saveV3Simulation, saveV3SimulationOnce } from "../../../../lib/v3-store";

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
  const payer = body?.payer;
  const requestId = body?.requestId;
  if (typeof productId !== "string" || !products.has(productId as V3ProductId) || !isV3Duration(durationMinutes) || (payer !== undefined && (typeof payer !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(payer))) || (requestId !== undefined && (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(requestId)))) {
    return NextResponse.json({ error: "Expected an allowlisted productId and durationMinutes (15, 30, or 60)." }, { status: 400 });
  }
  try {
    const session = request.headers.get(BETA_SESSION_HEADER);
    if (typeof requestId === "string") {
      const existing = await getV3SimulationByRequestId(requestId, session);
      if (existing) return NextResponse.json({ ...existing, reusedRequest: true }, { headers: { "cache-control": "no-store" } });
    }
    limitV3Simulation(session);
    const draft = simulateV3Deployment({ productId: productId as V3ProductId, durationMinutes, payer: payer as string | undefined, payTo: config.payTo, network: config.network.id, asset: config.network.usdcAddress, requestId: requestId as string | undefined });
    if (typeof requestId === "string") {
      const saved = await saveV3SimulationOnce(draft, session, requestId);
      return NextResponse.json({ ...saved.simulation, reusedRequest: saved.reused }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json(await saveV3Simulation(draft, session), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create simulation." }, { status: 400 });
  }
}
