import { NextRequest, NextResponse } from "next/server";
import { BETA_SESSION_HEADER, requireBetaSession } from "@/lib/beta";
import { moonPayAvailability, moonPayCheckoutUrl } from "@/lib/moonpay";
import { getV3Simulation } from "@/lib/v3-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const locked = requireBetaSession(request); if (locked) return locked;
  return NextResponse.json(moonPayAvailability(), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const locked = requireBetaSession(request); if (locked) return locked;
  const body = await request.json().catch(() => null) as { stackId?: string } | null;
  if (!body?.stackId || !/^sim-[a-f0-9-]{36}$/i.test(body.stackId)) return NextResponse.json({ error: "Expected a simulation stackId." }, { status: 400 });
  const simulation = await getV3Simulation(body.stackId, request.headers.get(BETA_SESSION_HEADER));
  if (!simulation) return NextResponse.json({ error: "Simulation not found." }, { status: 404 });
  if (["shutdown", "expired"].includes(simulation.status)) return NextResponse.json({ error: "MoonPay checkout is unavailable for a closed simulation." }, { status: 409 });
  try {
    const checkoutUrl = moonPayCheckoutUrl({ stackId: simulation.stackId, walletAddress: simulation.embeddedWallet.address, requestOrigin: request.nextUrl.origin });
    return NextResponse.json({ provider: "moonpay", checkoutUrl, ...moonPayAvailability(), warning: "This opens MoonPay's hosted checkout in a new tab. It cannot trigger GCP provisioning, x402 settlement, or a trade in this beta." }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MoonPay checkout is unavailable." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
