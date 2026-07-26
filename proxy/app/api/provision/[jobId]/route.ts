import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/store";
import { hasResourceCapability } from "@/lib/capability";
import { closeJob } from "@/lib/lifecycle";

export const runtime = "nodejs";

function authorized(req: NextRequest, jobId: string, payer: string) {
  return hasResourceCapability(jobId, payer, req.headers.get("x-resource-capability"));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const job = await getJob((await ctx.params).jobId);
  if (job && !authorized(req, job.id, job.payer)) return NextResponse.json({ error: "Resource capability required." }, { status: 401 });
  return job ? NextResponse.json(job) : NextResponse.json({ error: "Job not found" }, { status: 404 });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const job = await getJob((await ctx.params).jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!authorized(req, job.id, job.payer)) return NextResponse.json({ error: "Resource capability required." }, { status: 401 });
  await closeJob(job, "delete");
  return NextResponse.json({ jobId: job.id, status: "closed" });
}
