import { NextRequest, NextResponse } from "next/server";
import { requireBetaSession } from "@/lib/beta";
import { config } from "@/lib/config";
import { createV3TradingQuotePayload, isV3Duration, type V3PaperStrategyConfig } from "@/lib/v3";
import { signV3TradingQuote } from "@/lib/trading/v3-quote-token";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const locked = requireBetaSession(req); if (locked) return locked;
  let body: { durationMinutes?: number; payer?: string; requestId?: string; strategy?: Partial<V3PaperStrategyConfig> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  if (!isV3Duration(Number(body.durationMinutes)) || typeof body.payer !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(body.payer) || (body.requestId !== undefined && !/^[a-zA-Z0-9-]{1,128}$/.test(body.requestId))) {
    return NextResponse.json({ error: "Expected durationMinutes (15, 30, or 60), a payer address, and an optional safe requestId." }, { status: 400 });
  }
  try {
    const payload = createV3TradingQuotePayload({
      durationMinutes: Number(body.durationMinutes) as 15 | 30 | 60,
      payer: body.payer,
      payTo: config.payTo,
      asset: config.network.usdcAddress,
      strategy: body.strategy,
      requestId: body.requestId,
    });
    return NextResponse.json({ quote: payload, quoteToken: signV3TradingQuote(payload, config.quoteSecret), deploymentEnabled: config.v3TestnetDeploymentEnabled }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
