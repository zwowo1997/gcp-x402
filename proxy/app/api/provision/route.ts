import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { validateProvisionRequest, assertWithinSpendCap } from "@/lib/spend";
import { reserveJob, saveJob, recordTransaction } from "@/lib/store";
import { createResource, deleteResource } from "@/lib/provisioning";
import { buildRequirements, paymentRequiredBody, decodePaymentHeader, verify, settle, encodeSettlementHeader } from "@/lib/x402";
import { sha256, signQuote } from "@/lib/quote";
import { issueResourceCapability } from "@/lib/capability";
import { scheduleCleanup } from "@/lib/cleanup";
import { requireBetaSession } from "@/lib/beta";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const locked = requireBetaSession(req);
  if (locked) return locked;
  let body: { resourceId?: string; durationMinutes?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  const duration = body.durationMinutes ?? config.maxRentalMinutes;
  let item;
  try {
    item = validateProvisionRequest(body.resourceId ?? "", duration);
    if (duration > config.maxRentalMinutes) throw new Error(`Duration exceeds the operator maximum of ${config.maxRentalMinutes} minutes.`);
    assertWithinSpendCap(item, 0);
    if (config.testMode && config.network.id !== "base-sepolia") throw new Error("TEST_MODE only permits Base Sepolia.");
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  const resource = fwdHost ? `${fwdProto}://${fwdHost}/api/provision` : new URL(req.url).toString();
  const amount = String(Math.ceil(item.priceCeilingUsd * 1e6));
  const quoteToken = signQuote({ qhash: sha256(JSON.stringify(body)), bytes: 0, priceBaseUnits: amount, exp: Math.floor(Date.now() / 1000) + config.quoteTtlSeconds });
  const requirements = buildRequirements({ maxAmountRequired: amount, resource, description: `Provision ${item.id} for ${duration} minutes`, quoteToken });
  const paymentHeader = req.headers.get("x-payment");
  if (!paymentHeader) return NextResponse.json(paymentRequiredBody(requirements), { status: 402 });
  let payment;
  try { payment = decodePaymentHeader(paymentHeader); } catch { return NextResponse.json(paymentRequiredBody(requirements, "Malformed X-PAYMENT header."), { status: 402 }); }
  let verification;
  try { verification = await verify(payment, requirements); } catch (e) { return NextResponse.json({ error: `Payment verification error: ${(e as Error).message}` }, { status: 502 }); }
  if (!verification.isValid) return NextResponse.json(paymentRequiredBody(requirements, verification.invalidReason ?? "Payment invalid."), { status: 402 });
  const payer = verification.payer;
  if (!payer) return NextResponse.json({ error: "Facilitator did not return a payer identity." }, { status: 502 });
  const id = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + duration * 60_000);
  const txId = `provision-${id}`;
  const job = { id, payer, resourceId: item.id, status: "payment_pending" as const, maxGcpCostUsd: item.maxGcpCostUsd, settledAmountUsd: 0, createdAt: now.toISOString(), expiresAt: expires.toISOString() };
  try {
    await reserveJob(job, config.maxOutstandingGcpExposureUsd);
    await scheduleCleanup(id, expires);
  } catch (e) {
    await saveJob({ ...job, status: "failed", error: (e as Error).message });
    return NextResponse.json({ error: `Unable to reserve safe provisioning capacity: ${(e as Error).message}` }, { status: 409 });
  }
  await recordTransaction({ id: txId, payer, service: item.kind, operation: "provision", status: "verified", requestedAmountUsd: item.priceCeilingUsd, resourceId: id, createdAt: now.toISOString() });
  try {
    const resourceId = await createResource(item, id);
    await saveJob({ ...job, status: "provisioning", gcpResourceId: resourceId });
    let settlement;
    try { settlement = await settle(payment, requirements); } catch (e) {
      await deleteResource(item, resourceId).catch(() => undefined);
      await saveJob({ ...job, status: "failed", gcpResourceId: resourceId, error: `Settlement error: ${(e as Error).message}` });
      return NextResponse.json({ error: `Settlement error: ${(e as Error).message}` }, { status: 502 });
    }
    if (!settlement.success) {
      await deleteResource(item, resourceId).catch(() => undefined);
      await saveJob({ ...job, status: "failed", gcpResourceId: resourceId, error: settlement.errorReason ?? "Settlement failed" });
      return NextResponse.json({ error: `Settlement failed: ${settlement.errorReason ?? "unknown"}` }, { status: 502 });
    }
    await saveJob({ ...job, status: "active", settledAmountUsd: item.priceCeilingUsd, gcpResourceId: resourceId });
    await recordTransaction({ id: txId, payer, service: item.kind, operation: "provision", status: "settled", requestedAmountUsd: item.priceCeilingUsd, settledAmountUsd: item.priceCeilingUsd, resourceId: id, createdAt: now.toISOString(), completedAt: new Date().toISOString() });
    const response = NextResponse.json({ jobId: id, resourceId, expiresAt: expires.toISOString(), maxPriceUsd: item.priceCeilingUsd, capability: issueResourceCapability(id, payer) });
    response.headers.set("X-PAYMENT-RESPONSE", encodeSettlementHeader(settlement));
    return response;
  } catch (e) {
    await saveJob({ ...job, status: "failed", error: (e as Error).message });
    await recordTransaction({ id: txId, payer, service: item.kind, operation: "provision", status: "failed", requestedAmountUsd: item.priceCeilingUsd, resourceId: id, createdAt: now.toISOString(), completedAt: new Date().toISOString(), error: (e as Error).message });
    return NextResponse.json({ error: `Provisioning failed: ${(e as Error).message}` }, { status: 502 });
  }
}
