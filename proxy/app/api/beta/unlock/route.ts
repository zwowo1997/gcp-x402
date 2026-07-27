import { NextRequest, NextResponse } from "next/server";
import { issueBetaSession, passwordMatches } from "@/lib/beta";
import { dashboardPreflight, withDashboardCors } from "@/lib/dashboard-cors";

export const runtime = "nodejs";

const failedAttempts: number[] = [];
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

function trimFailures(now: number) {
  while (failedAttempts.length && failedAttempts[0] <= now - WINDOW_MS) failedAttempts.shift();
}

export async function POST(req: NextRequest) {
  const now = Date.now();
  trimFailures(now);
  if (failedAttempts.length >= MAX_FAILURES) {
    const retryAfter = Math.max(1, Math.ceil((failedAttempts[0] + WINDOW_MS - now) / 1000));
    return withDashboardCors(req, NextResponse.json({ error: "Unlock temporarily disabled after repeated failures." }, { status: 429, headers: { "retry-after": String(retryAfter), "cache-control": "no-store" } }));
  }
  const body = await req.json().catch(() => ({}));
  if (typeof body.password !== "string" || body.password.length > 256 || !passwordMatches(body.password)) {
    failedAttempts.push(now);
    return withDashboardCors(req, NextResponse.json({ error: "Invalid beta password." }, { status: 401, headers: { "cache-control": "no-store" } }));
  }
  failedAttempts.length = 0;
  try {
    return withDashboardCors(req, NextResponse.json(issueBetaSession(), { headers: { "cache-control": "no-store" } }));
  } catch {
    return withDashboardCors(req, NextResponse.json({ error: "Private-beta access is not configured." }, { status: 503, headers: { "cache-control": "no-store" } }));
  }
}

export function OPTIONS(req: NextRequest) { return dashboardPreflight(req); }
