import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { expireTradingStack } from "@/lib/trading/lifecycle";

export async function POST(req: NextRequest) {
  const actual = req.headers.get("x-cleanup-token") ?? "";
  const expected = config.cleanupToken ?? "";
  if (!actual || actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.stackId !== "string") return NextResponse.json({ error: "stackId required." }, { status: 400 });
  return NextResponse.json({ closed: await expireTradingStack(body.stackId) });
}
