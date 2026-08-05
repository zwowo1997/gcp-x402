import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { BETA_SESSION_HEADER, requireBetaSession } from "@/lib/beta";
import { issueDashboardAccess, issueResourceCapability } from "@/lib/capability";
import { scheduleTradingCleanup } from "@/lib/cleanup";
import { config } from "@/lib/config";
import { addTradingEvent, findTradingStackByRequestKey, reserveTradingStack, saveTradingStack } from "@/lib/trading/store";
import { createTradingStackResources, deleteTradingStackResources } from "@/lib/trading/provisioning";
import { tradingCostBreakdown, tradingCostSummary } from "@/lib/trading/costs";
import { tradingStackFromV3Quote } from "@/lib/trading/v3-lease";
import { validateV3ExactSettlement, usdToUsdcBaseUnits } from "@/lib/trading/v3-payment";
import { authenticateV3TradingQuoteToken, verifyV3TradingQuoteToken } from "@/lib/trading/v3-quote-token";
import { type TradingStackRecord } from "@/lib/trading/types";
import { buildRequirements, decodePaymentHeader, encodeSettlementHeader, paymentRequiredBody, settle, verify } from "@/lib/x402";
import { recordTransaction } from "@/lib/store";

export const runtime = "nodejs";

function responseFor(stack: TradingStackRecord, betaSession: string): NextResponse {
  const capability = issueResourceCapability(stack.id, stack.payer);
  const dashboard = config.tradingDashboardUrl ? new URL(`/strategy/${stack.id}`, config.tradingDashboardUrl) : undefined;
  if (dashboard) dashboard.searchParams.set("access", issueDashboardAccess(stack.id, stack.payer, stack.expiresAt));
  const dashboardUrl = dashboard?.toString();
  const durationMinutes = stack.durationMinutes ?? 60;
  const settledAmountUsd = stack.settledAmountUsd;
  return NextResponse.json({
    stackId: stack.id, quoteId: stack.quoteId, mode: "paper", paperOnly: true,
    region: config.tradingRegion, durationMinutes, expiresAt: stack.expiresAt,
    expectedChargeUsd: stack.expectedChargeUsd, authorizationCapUsd: stack.authorizationCapUsd,
    settledAmountUsd,
    unusedAuthorizationUsd: Number(Math.max(0, (stack.authorizationCapUsd ?? settledAmountUsd) - settledAmountUsd).toFixed(6)),
    capability, dashboardUrl, resources: stack.resources,
    costBreakdown: tradingCostBreakdown(stack.resources, durationMinutes),
    costSummary: tradingCostSummary(stack.resources, durationMinutes, settledAmountUsd),
  });
}

function existingResponse(stack: TradingStackRecord, betaSession: string): NextResponse {
  if (stack.status === "running" && stack.settledAmountUsd > 0) return responseFor(stack, betaSession);
  if (["payment_pending", "provisioning"].includes(stack.status)) return NextResponse.json({ error: "This quoted deployment is already in progress.", stackId: stack.id, status: stack.status, retryable: true }, { status: 409 });
  return NextResponse.json({ error: "This quoted deployment finished without a reusable result.", stackId: stack.id, status: stack.status, retryable: false }, { status: 409 });
}

export async function POST(req: NextRequest) {
  const locked = requireBetaSession(req); if (locked) return locked;
  if (!config.v3TestnetDeploymentEnabled) return NextResponse.json({ error: "V3 Base Sepolia deployment is disabled in this environment." }, { status: 503 });
  if (!config.testMode || config.network.id !== "base-sepolia") return NextResponse.json({ error: "V3 deployment requires Base Sepolia test mode." }, { status: 503 });
  let body: { quoteToken?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  if (!body.quoteToken) return NextResponse.json({ error: "A signed quoteToken is required." }, { status: 400 });
  const authenticatedQuote = authenticateV3TradingQuoteToken(body.quoteToken, config.quoteSecret);
  if (!authenticatedQuote) return NextResponse.json({ error: "Trading quote is invalid or modified." }, { status: 400 });
  // Recovery precedes expiry and payment checks. A lost HTTP response can then
  // retrieve the one already-reserved result without another authorization.
  const existing = await findTradingStackByRequestKey(authenticatedQuote.requestId);
  if (existing) return existingResponse(existing, req.headers.get(BETA_SESSION_HEADER) ?? "");
  const quote = verifyV3TradingQuoteToken(body.quoteToken, config.quoteSecret);
  if (!quote) return NextResponse.json({ error: "Trading quote is expired. Create a fresh quote before starting a new deployment." }, { status: 400 });

  const amount = usdToUsdcBaseUnits(quote.quote.expectedChargeUsd);
  const resource = `${new URL(req.url).origin}/api/v3/trading/deploy`;
  const requirements = buildRequirements({
    maxAmountRequired: amount,
    resource,
    description: `Deploy a ${quote.quote.durationMinutes}-minute Tokyo Hyperliquid BTC paper-trading stack`,
    quoteToken: body.quoteToken,
    maxTimeoutSeconds: config.tradingPaymentTimeoutSeconds,
  });
  const header = req.headers.get("x-payment");
  if (!header) return NextResponse.json(paymentRequiredBody(requirements), { status: 402 });
  let payment;
  try { payment = decodePaymentHeader(header); } catch { return NextResponse.json(paymentRequiredBody(requirements, "Malformed X-PAYMENT header."), { status: 402 }); }
  const verification = await verify(payment, requirements).catch((error) => ({ isValid: false, invalidReason: (error as Error).message }));
  if (!verification.isValid) return NextResponse.json(paymentRequiredBody(requirements, verification.invalidReason ?? "Payment invalid."), { status: 402 });
  if (!("payer" in verification) || !verification.payer) return NextResponse.json({ error: "Facilitator did not return a payer identity." }, { status: 502 });
  try { validateV3ExactSettlement(quote, verification.payer, config.maxGcpCostPerProvisionUsd); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }

  const now = new Date();
  let stack: TradingStackRecord;
  try { stack = tradingStackFromV3Quote(quote, now, randomUUID()); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  let reservation;
  try { reservation = await reserveTradingStack(stack, config.maxOutstandingGcpExposureUsd); }
  catch (error) { return NextResponse.json({ error: `Unable to reserve safe paper-trading capacity: ${(error as Error).message}` }, { status: 409 }); }
  if (!reservation.created) return existingResponse(reservation.stack, req.headers.get(BETA_SESSION_HEADER) ?? "");
  const expiresAt = new Date(stack.expiresAt);
  try { await scheduleTradingCleanup(stack.id, expiresAt); }
  catch (error) {
    await saveTradingStack({ ...stack, status: "failed", error: (error as Error).message, updatedAt: new Date().toISOString() });
    return NextResponse.json({ error: `Unable to schedule safe cleanup: ${(error as Error).message}` }, { status: 502 });
  }
  await recordTransaction({ id: `v3-trading-${stack.id}`, payer: stack.payer, service: "trading", operation: "deploy_paper_v3", status: "verified", requestedAmountUsd: quote.quote.expectedChargeUsd, resourceId: stack.id, createdAt: now.toISOString() });
  let settledStack: TradingStackRecord | undefined;
  let settledPayment: Awaited<ReturnType<typeof settle>> | undefined;
  try {
    await saveTradingStack({ ...stack, status: "provisioning", updatedAt: new Date().toISOString() });
    await createTradingStackResources(stack.resources, stack.config);
    try { settledPayment = await settle(payment, requirements); }
    catch (error) { await deleteTradingStackResources(stack.resources).catch(() => undefined); throw error; }
    if (!settledPayment.success) { await deleteTradingStackResources(stack.resources).catch(() => undefined); throw new Error(settledPayment.errorReason ?? "Settlement failed"); }
    settledStack = { ...stack, status: "running" as const, settledAmountUsd: quote.quote.expectedChargeUsd, updatedAt: new Date().toISOString() };
    await saveTradingStack(settledStack);
    await addTradingEvent({ id: randomUUID(), stackId: stack.id, type: "provisioned", message: `${quote.quote.durationMinutes}-minute Tokyo paper stack provisioned; no live exchange order can be placed.`, createdAt: new Date().toISOString() });
    await recordTransaction({ id: `v3-trading-${stack.id}`, payer: stack.payer, service: "trading", operation: "deploy_paper_v3", status: "settled", requestedAmountUsd: quote.quote.expectedChargeUsd, settledAmountUsd: quote.quote.expectedChargeUsd, resourceId: stack.id, createdAt: now.toISOString(), completedAt: new Date().toISOString() });
    const response = responseFor(settledStack, req.headers.get(BETA_SESSION_HEADER) ?? "");
    response.headers.set("X-PAYMENT-RESPONSE", encodeSettlementHeader(settledPayment));
    return response;
  } catch (error) {
    if (settledStack && settledPayment?.success) {
      await saveTradingStack(settledStack).catch(() => undefined);
      const response = responseFor(settledStack, req.headers.get(BETA_SESSION_HEADER) ?? "");
      response.headers.set("X-PAYMENT-RESPONSE", encodeSettlementHeader(settledPayment));
      response.headers.set("X-GCP-X402-RECOVERY", "post-settlement bookkeeping incomplete; retain this receipt and retry status later");
      return response;
    }
    const failed = { ...stack, status: "failed" as const, error: (error as Error).message, updatedAt: new Date().toISOString() };
    await saveTradingStack(failed);
    await addTradingEvent({ id: randomUUID(), stackId: stack.id, type: "failed", message: failed.error ?? "Provisioning failed.", createdAt: new Date().toISOString() });
    await recordTransaction({ id: `v3-trading-${stack.id}`, payer: stack.payer, service: "trading", operation: "deploy_paper_v3", status: "failed", requestedAmountUsd: quote.quote.expectedChargeUsd, resourceId: stack.id, createdAt: now.toISOString(), completedAt: new Date().toISOString(), error: failed.error });
    return NextResponse.json({ error: `V3 paper trading provisioning failed: ${failed.error}` }, { status: 502 });
  }
}
