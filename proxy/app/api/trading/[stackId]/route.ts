import { NextRequest, NextResponse } from "next/server";
import { hasResourceCapability } from "@/lib/capability";
import { tradingMetrics } from "@/lib/trading/metrics";
import { getTradingStack, listTradingEvents } from "@/lib/trading/store";
import { requireBetaSession } from "@/lib/beta";
import { dashboardPreflight, withDashboardCors } from "@/lib/dashboard-cors";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ stackId: string }> }) {
  const locked = requireBetaSession(req);
  if (locked) return withDashboardCors(req, locked);
  const stack = await getTradingStack((await ctx.params).stackId);
  if (!stack) return withDashboardCors(req, NextResponse.json({ error: "Trading stack not found." }, { status: 404 }));
  if (!hasResourceCapability(stack.id, stack.payer, req.headers.get("x-resource-capability"))) return withDashboardCors(req, NextResponse.json({ error: "Trading stack capability required." }, { status: 401 }));
  const [events, metrics] = await Promise.all([
    listTradingEvents(stack.id),
    tradingMetrics(stack.resources).catch((error) => ({ unavailable: true, reason: (error as Error).message })),
  ]);
  return withDashboardCors(req, NextResponse.json({ stack, events, metrics, paperOnly: true }));
}

export function OPTIONS(req: NextRequest) { return dashboardPreflight(req); }
