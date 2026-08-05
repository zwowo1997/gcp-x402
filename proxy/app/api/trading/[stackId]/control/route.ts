import { NextRequest, NextResponse } from "next/server";
import { hasDashboardAccess, hasResourceCapability } from "@/lib/capability";
import { controlTradingStack } from "@/lib/trading/lifecycle";
import { getTradingStack } from "@/lib/trading/store";
import { type TradingControl } from "@/lib/trading/types";
import { requireBetaSession } from "@/lib/beta";
import { dashboardPreflight, withDashboardCors } from "@/lib/dashboard-cors";

export const runtime = "nodejs";
const controls = new Set<TradingControl>(["start", "stop", "resume", "shutdown"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ stackId: string }> }) {
  const stack = await getTradingStack((await ctx.params).stackId);
  if (!stack) return withDashboardCors(req, NextResponse.json({ error: "Trading stack not found." }, { status: 404 }));
  if (!hasDashboardAccess(stack.id, stack.payer, req.headers.get("x-dashboard-access") ?? req.headers.get("x-resource-capability"))) {
    const locked = requireBetaSession(req); if (locked) return withDashboardCors(req, locked);
    if (!hasResourceCapability(stack.id, stack.payer, req.headers.get("x-resource-capability"))) return withDashboardCors(req, NextResponse.json({ error: "Trading stack capability required." }, { status: 401 }));
  }
  const body = await req.json().catch(() => ({}));
  if (!controls.has(body.control)) return withDashboardCors(req, NextResponse.json({ error: "control must be start, stop, resume, or shutdown." }, { status: 400 }));
  try { return withDashboardCors(req, NextResponse.json({ stack: await controlTradingStack(stack, body.control), paperOnly: true })); }
  catch (error) { return withDashboardCors(req, NextResponse.json({ error: (error as Error).message }, { status: 409 })); }
}

export function OPTIONS(req: NextRequest) { return dashboardPreflight(req); }
