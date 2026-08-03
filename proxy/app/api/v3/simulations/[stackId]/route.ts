import { NextRequest, NextResponse } from "next/server";
import { BETA_SESSION_HEADER, requireBetaSession } from "@/lib/beta";
import { getV3Simulation, transitionV3Simulation } from "@/lib/v3-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ stackId: string }> }) {
  const locked = requireBetaSession(req); if (locked) return locked;
  const { stackId } = await params;
  const simulation = getV3Simulation(stackId, req.headers.get(BETA_SESSION_HEADER));
  return simulation ? NextResponse.json(simulation, { headers: { "cache-control": "no-store" } }) : NextResponse.json({ error: "Simulation not found." }, { status: 404 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ stackId: string }> }) {
  const locked = requireBetaSession(req); if (locked) return locked;
  const { stackId } = await params;
  const body = await req.json().catch(() => null) as { action?: "approve" | "fund" | "provision" | "stop" | "resume" | "shutdown" | "cancel" } | null;
  if (!body?.action || !["approve", "fund", "provision", "stop", "resume", "shutdown", "cancel"].includes(body.action)) return NextResponse.json({ error: "Unsupported simulation action." }, { status: 400 });
  try { return NextResponse.json(transitionV3Simulation(stackId, req.headers.get(BETA_SESSION_HEADER), body.action), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Simulation action failed." }, { status: 409 }); }
}
