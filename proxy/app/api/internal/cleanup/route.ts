import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { closeJobById } from "@/lib/lifecycle";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!config.cleanupToken || req.headers.get("x-cleanup-token") !== config.cleanupToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { jobId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  if (!body.jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  const closed = await closeJobById(body.jobId, "expiry");
  return NextResponse.json({ jobId: body.jobId, closed });
}
