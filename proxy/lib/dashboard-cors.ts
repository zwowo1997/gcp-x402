import { NextRequest, NextResponse } from "next/server";
import { config } from "./config";

function allowedOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (!origin || !config.tradingDashboardUrl) return null;
  try { return origin === new URL(config.tradingDashboardUrl).origin ? origin : null; }
  catch { return null; }
}

export function withDashboardCors(req: NextRequest, response: NextResponse): NextResponse {
  const origin = allowedOrigin(req);
  if (!origin) return response;
  response.headers.set("access-control-allow-origin", origin);
  response.headers.set("access-control-allow-headers", "content-type, x-gcp-x402-session, x-resource-capability, x-dashboard-access");
  response.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  response.headers.set("access-control-max-age", "600");
  response.headers.set("vary", "Origin");
  return response;
}

export function dashboardPreflight(req: NextRequest): NextResponse {
  if (!allowedOrigin(req)) return NextResponse.json({ error: "Origin not allowed." }, { status: 403 });
  return withDashboardCors(req, new NextResponse(null, { status: 204 }));
}
