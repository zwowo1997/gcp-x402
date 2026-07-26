import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { dashboardSnapshot } from "@/lib/dashboard";
import { timingSafeEqual } from "node:crypto";

function authorized(req: NextRequest) {
  if (!config.dashboardToken) return false;
  const actual = req.headers.get("authorization");
  const expected = `Bearer ${config.dashboardToken}`;
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Dashboard authorization required." }, { status: 401 });
  return NextResponse.json(await dashboardSnapshot());
}
