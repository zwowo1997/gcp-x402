import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";

function matches(value: string, expected: string) {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  let body: { token?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  if (!config.dashboardToken || !body.token || !matches(body.token, config.dashboardToken)) return NextResponse.json({ error: "Invalid dashboard token." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("gcp_x402_dashboard", config.dashboardToken, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/dashboard", maxAge: 60 * 60 * 8 });
  return response;
}
