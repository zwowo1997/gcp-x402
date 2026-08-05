import { NextRequest, NextResponse } from "next/server";
import { hasDashboardAccess, hasResourceCapability } from "@/lib/capability";
import { tradingMetrics } from "@/lib/trading/metrics";
import { getTradingStack, listTradingEvents } from "@/lib/trading/store";
import { requireBetaSession } from "@/lib/beta";
import { dashboardPreflight, withDashboardCors } from "@/lib/dashboard-cors";
import { tradingCostBreakdown, tradingCostSummary } from "@/lib/trading/costs";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ stackId: string }> }) {
  const stack = await getTradingStack((await ctx.params).stackId);
  if (!stack) return withDashboardCors(req, NextResponse.json({ error: "Trading stack not found." }, { status: 404 }));
  if (!hasDashboardAccess(stack.id, stack.payer, req.headers.get("x-dashboard-access"))) {
    const locked = requireBetaSession(req); if (locked) return withDashboardCors(req, locked);
    if (!hasResourceCapability(stack.id, stack.payer, req.headers.get("x-resource-capability"))) return withDashboardCors(req, NextResponse.json({ error: "Trading stack capability required." }, { status: 401 }));
  }
  const [events, metrics] = await Promise.all([
    listTradingEvents(stack.id),
    tradingMetrics(stack.resources).catch((error) => ({ unavailable: true, reason: (error as Error).message })),
  ]);
  const durationMinutes = stack.durationMinutes ?? 60;
  const settledAmountUsd = stack.settledAmountUsd;
  const authorizationCapUsd = stack.authorizationCapUsd ?? settledAmountUsd;
  return withDashboardCors(req, NextResponse.json({
    stack, events, metrics,
    durationMinutes,
    expectedChargeUsd: stack.expectedChargeUsd ?? settledAmountUsd,
    authorizationCapUsd,
    settledAmountUsd,
    unusedAuthorizationUsd: Number(Math.max(0, authorizationCapUsd - settledAmountUsd).toFixed(6)),
    costBreakdown: tradingCostBreakdown(stack.resources, durationMinutes),
    costSummary: tradingCostSummary(stack.resources, durationMinutes, settledAmountUsd),
    paperOnly: true,
  }));
}

export function OPTIONS(req: NextRequest) { return dashboardPreflight(req); }
