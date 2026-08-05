import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { scheduleTradingCleanup } from "@/lib/cleanup";
import { issueDashboardAccess, issueResourceCapability } from "@/lib/capability";
import { sha256, signQuote } from "@/lib/quote";
import { buildRequirements, decodePaymentHeader, encodeSettlementHeader, paymentRequiredBody, settle, verify } from "@/lib/x402";
import { PAPER_TRADING_PROFILE, defaultPaperConfig } from "@/lib/trading/catalog";
import { createTradingStackResources, deleteTradingStackResources, tradingResources } from "@/lib/trading/provisioning";
import { addTradingEvent, findTradingStackByRequestKey, reserveTradingStack, saveTradingStack } from "@/lib/trading/store";
import { type PaperStrategyConfig, type TradingStackRecord } from "@/lib/trading/types";
import { tradingCostBreakdown, tradingCostSummary } from "@/lib/trading/costs";
import { recordTransaction } from "@/lib/store";
import { BETA_SESSION_HEADER, requireBetaSession } from "@/lib/beta";

export const runtime = "nodejs";

function deploymentResponse(stack: TradingStackRecord, betaSession: string): NextResponse {
  const capability = issueResourceCapability(stack.id, stack.payer);
  const dashboard = config.tradingDashboardUrl ? new URL(`/strategy/${stack.id}`, config.tradingDashboardUrl) : undefined;
  if (dashboard) dashboard.searchParams.set("access", issueDashboardAccess(stack.id, stack.payer, stack.expiresAt));
  const dashboardUrl = dashboard?.toString();
  return NextResponse.json({ stackId: stack.id, mode: "paper", region: config.tradingRegion, expiresAt: stack.expiresAt, maxPriceUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, capability, dashboardUrl, resources: stack.resources, costBreakdown: tradingCostBreakdown(stack.resources), costSummary: tradingCostSummary(stack.resources), paperOnly: true });
}

function existingReservationResponse(stack: TradingStackRecord, betaSession: string): NextResponse {
  if (stack.status === "running" && stack.settledAmountUsd > 0) return deploymentResponse(stack, betaSession);
  if (["payment_pending", "provisioning"].includes(stack.status)) return NextResponse.json({ error: "This deployment is already in progress.", stackId: stack.id, status: stack.status, retryable: true }, { status: 409 });
  return NextResponse.json({ error: "This deployment request already finished without a reusable result. Submit a fresh payment request.", stackId: stack.id, status: stack.status, retryable: false }, { status: 409 });
}

export async function POST(req: NextRequest) {
  const locked = requireBetaSession(req);
  if (locked) return locked;
  let body: { profileId?: string; requestId?: string; config?: Partial<PaperStrategyConfig> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  if (body.profileId !== PAPER_TRADING_PROFILE.id) return NextResponse.json({ error: `Only ${PAPER_TRADING_PROFILE.id} is available in this release.` }, { status: 400 });
  let paperConfig;
  try { paperConfig = defaultPaperConfig(body.config ?? {}); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  if (!config.testMode || config.network.id !== "base-sepolia") return NextResponse.json({ error: "Paper trading deployment is available only with Base Sepolia x402 testing payments." }, { status: 400 });

  const resource = `${new URL(req.url).origin}/api/trading/deploy`;
  const amount = String(Math.ceil(PAPER_TRADING_PROFILE.priceCeilingUsd * 1e6));
  const quoteToken = signQuote({ qhash: sha256(JSON.stringify(body)), bytes: 0, priceBaseUnits: amount, exp: Math.floor(Date.now() / 1000) + config.tradingPaymentTimeoutSeconds });
  const requirements = buildRequirements({ maxAmountRequired: amount, resource, description: `Deploy a ${config.tradingLeaseHours}-hour Tokyo Hyperliquid BTC paper-trading stack`, quoteToken, maxTimeoutSeconds: config.tradingPaymentTimeoutSeconds });
  const header = req.headers.get("x-payment");
  if (!header) return NextResponse.json(paymentRequiredBody(requirements), { status: 402 });
  let payment;
  try { payment = decodePaymentHeader(header); } catch { return NextResponse.json(paymentRequiredBody(requirements, "Malformed X-PAYMENT header."), { status: 402 }); }
  const requestKey = body.requestId?.trim() || sha256(JSON.stringify(payment.payload));
  const existing = await findTradingStackByRequestKey(requestKey);
  if (existing) return existingReservationResponse(existing, req.headers.get(BETA_SESSION_HEADER) ?? "");
  const verification = await verify(payment, requirements).catch((error) => ({ isValid: false, invalidReason: (error as Error).message }));
  if (!verification.isValid) return NextResponse.json(paymentRequiredBody(requirements, verification.invalidReason ?? "Payment invalid."), { status: 402 });
  if (!("payer" in verification) || !verification.payer) return NextResponse.json({ error: "Facilitator did not return a payer identity." }, { status: 502 });

  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.tradingLeaseHours * 60 * 60_000);
  const resources = tradingResources(id);
  const stack: TradingStackRecord = { id, payer: verification.payer, requestKey, profileId: PAPER_TRADING_PROFILE.id, status: "payment_pending", mode: "paper", config: paperConfig, resources, maxGcpCostUsd: PAPER_TRADING_PROFILE.maxGcpCostUsd, settledAmountUsd: 0, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), updatedAt: now.toISOString() };
  let reservation;
  try { reservation = await reserveTradingStack(stack, config.maxOutstandingGcpExposureUsd); }
  catch (error) {
    return NextResponse.json({ error: `Unable to reserve safe paper-trading capacity: ${(error as Error).message}` }, { status: 409 });
  }
  if (!reservation.created) return existingReservationResponse(reservation.stack, req.headers.get(BETA_SESSION_HEADER) ?? "");
  try { await scheduleTradingCleanup(id, expiresAt); }
  catch (error) {
    const failed = { ...stack, status: "failed" as const, error: (error as Error).message, updatedAt: new Date().toISOString() };
    await saveTradingStack(failed);
    return NextResponse.json({ error: `Unable to schedule safe paper-trading cleanup: ${failed.error}` }, { status: 502 });
  }
  await recordTransaction({ id: `trading-${id}`, payer: stack.payer, service: "trading", operation: "deploy_paper", status: "verified", requestedAmountUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, resourceId: id, createdAt: now.toISOString() });
  try {
    await saveTradingStack({ ...stack, status: "provisioning", updatedAt: new Date().toISOString() });
    await createTradingStackResources(resources, paperConfig);
    let settlement;
    try { settlement = await settle(payment, requirements); }
    catch (error) { await deleteTradingStackResources(resources).catch(() => undefined); throw error; }
    if (!settlement.success) { await deleteTradingStackResources(resources).catch(() => undefined); throw new Error(settlement.errorReason ?? "Settlement failed"); }
    const active = { ...stack, status: "running" as const, settledAmountUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, updatedAt: new Date().toISOString() };
    await saveTradingStack(active);
    await addTradingEvent({ id: randomUUID(), stackId: id, type: "provisioned", message: "Tokyo paper trading stack provisioned. It uses real market data and simulated orders only.", createdAt: new Date().toISOString() });
    await recordTransaction({ id: `trading-${id}`, payer: stack.payer, service: "trading", operation: "deploy_paper", status: "settled", requestedAmountUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, settledAmountUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, resourceId: id, createdAt: now.toISOString(), completedAt: new Date().toISOString() });
    const betaSession = req.headers.get(BETA_SESSION_HEADER) ?? "";
    // Firebase Hosting rewrites /api/* to this Cloud Run service. Keeping the
    // backend out of the URL means a modified dashboard link cannot exfiltrate
    // the short-lived session and resource capability headers to another host.
    const response = deploymentResponse(active, betaSession);
    response.headers.set("X-PAYMENT-RESPONSE", encodeSettlementHeader(settlement));
    return response;
  } catch (error) {
    const failed = { ...stack, status: "failed" as const, error: (error as Error).message, updatedAt: new Date().toISOString() };
    await saveTradingStack(failed);
    await addTradingEvent({ id: randomUUID(), stackId: id, type: "failed", message: failed.error ?? "Provisioning failed.", createdAt: new Date().toISOString() });
    await recordTransaction({ id: `trading-${id}`, payer: stack.payer, service: "trading", operation: "deploy_paper", status: "failed", requestedAmountUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, resourceId: id, createdAt: now.toISOString(), completedAt: new Date().toISOString(), error: failed.error });
    return NextResponse.json({ error: `Paper trading provisioning failed: ${failed.error}` }, { status: 502 });
  }
}
