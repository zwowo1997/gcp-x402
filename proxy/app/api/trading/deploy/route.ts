import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { scheduleTradingCleanup } from "@/lib/cleanup";
import { issueResourceCapability } from "@/lib/capability";
import { sha256, signQuote } from "@/lib/quote";
import { buildRequirements, decodePaymentHeader, encodeSettlementHeader, paymentRequiredBody, settle, verify } from "@/lib/x402";
import { PAPER_TRADING_PROFILE, defaultPaperConfig } from "@/lib/trading/catalog";
import { createTradingStackResources, deleteTradingStackResources, deleteUnusedTradingSpannerInstance, tradingResources } from "@/lib/trading/provisioning";
import { addTradingEvent, reserveTradingStack, saveTradingStack } from "@/lib/trading/store";
import { type PaperStrategyConfig, type TradingStackRecord } from "@/lib/trading/types";
import { recordTransaction } from "@/lib/store";
import { BETA_SESSION_HEADER, requireBetaSession } from "@/lib/beta";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const locked = requireBetaSession(req);
  if (locked) return locked;
  let body: { profileId?: string; config?: Partial<PaperStrategyConfig> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }
  if (body.profileId !== PAPER_TRADING_PROFILE.id) return NextResponse.json({ error: `Only ${PAPER_TRADING_PROFILE.id} is available in this release.` }, { status: 400 });
  let paperConfig;
  try { paperConfig = defaultPaperConfig(body.config ?? {}); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  if (!config.testMode || config.network.id !== "base-sepolia") return NextResponse.json({ error: "Paper trading deployment is available only with Base Sepolia x402 testing payments." }, { status: 400 });

  const resource = `${new URL(req.url).origin}/api/trading/deploy`;
  const amount = String(Math.ceil(PAPER_TRADING_PROFILE.priceCeilingUsd * 1e6));
  const quoteToken = signQuote({ qhash: sha256(JSON.stringify(body)), bytes: 0, priceBaseUnits: amount, exp: Math.floor(Date.now() / 1000) + config.quoteTtlSeconds });
  const requirements = buildRequirements({ maxAmountRequired: amount, resource, description: "Deploy a 24-hour Tokyo Hyperliquid BTC paper-trading stack", quoteToken });
  const header = req.headers.get("x-payment");
  if (!header) return NextResponse.json(paymentRequiredBody(requirements), { status: 402 });
  let payment;
  try { payment = decodePaymentHeader(header); } catch { return NextResponse.json(paymentRequiredBody(requirements, "Malformed X-PAYMENT header."), { status: 402 }); }
  const verification = await verify(payment, requirements).catch((error) => ({ isValid: false, invalidReason: (error as Error).message }));
  if (!verification.isValid) return NextResponse.json(paymentRequiredBody(requirements, verification.invalidReason ?? "Payment invalid."), { status: 402 });
  if (!("payer" in verification) || !verification.payer) return NextResponse.json({ error: "Facilitator did not return a payer identity." }, { status: 502 });

  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.tradingLeaseHours * 60 * 60_000);
  const resources = tradingResources(id);
  const stack: TradingStackRecord = { id, payer: verification.payer, profileId: PAPER_TRADING_PROFILE.id, status: "payment_pending", mode: "paper", config: paperConfig, resources, maxGcpCostUsd: PAPER_TRADING_PROFILE.maxGcpCostUsd, settledAmountUsd: 0, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), updatedAt: now.toISOString() };
  try {
    await reserveTradingStack(stack, config.maxOutstandingGcpExposureUsd);
    await scheduleTradingCleanup(id, expiresAt);
  } catch (error) {
    await saveTradingStack({ ...stack, status: "failed", error: (error as Error).message, updatedAt: new Date().toISOString() });
    return NextResponse.json({ error: `Unable to reserve safe paper-trading capacity: ${(error as Error).message}` }, { status: 409 });
  }
  await recordTransaction({ id: `trading-${id}`, payer: stack.payer, service: "trading", operation: "deploy_paper", status: "verified", requestedAmountUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, resourceId: id, createdAt: now.toISOString() });
  try {
    await createTradingStackResources(resources, paperConfig);
    let settlement;
    try { settlement = await settle(payment, requirements); }
    catch (error) { await deleteTradingStackResources(resources).catch(() => undefined); throw error; }
    if (!settlement.success) { await deleteTradingStackResources(resources).catch(() => undefined); throw new Error(settlement.errorReason ?? "Settlement failed"); }
    const active = { ...stack, status: "running" as const, settledAmountUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, updatedAt: new Date().toISOString() };
    await saveTradingStack(active);
    await addTradingEvent({ id: randomUUID(), stackId: id, type: "provisioned", message: "Tokyo paper trading stack provisioned. It uses real market data and simulated orders only.", createdAt: new Date().toISOString() });
    await recordTransaction({ id: `trading-${id}`, payer: stack.payer, service: "trading", operation: "deploy_paper", status: "settled", requestedAmountUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, settledAmountUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, resourceId: id, createdAt: now.toISOString(), completedAt: new Date().toISOString() });
    const capability = issueResourceCapability(id, stack.payer);
    const betaSession = req.headers.get(BETA_SESSION_HEADER) ?? "";
    const dashboardUrl = config.tradingDashboardUrl ? `${config.tradingDashboardUrl}/strategy/${id}?api=${encodeURIComponent(config.publicBaseUrl ?? "")}#capability=${encodeURIComponent(capability)}&session=${encodeURIComponent(betaSession)}` : undefined;
    const response = NextResponse.json({ stackId: id, mode: "paper", region: config.tradingRegion, expiresAt: active.expiresAt, maxPriceUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, capability, dashboardUrl, resources, paperOnly: true });
    response.headers.set("X-PAYMENT-RESPONSE", encodeSettlementHeader(settlement));
    return response;
  } catch (error) {
    const failed = { ...stack, status: "failed" as const, error: (error as Error).message, updatedAt: new Date().toISOString() };
    await saveTradingStack(failed);
    await addTradingEvent({ id: randomUUID(), stackId: id, type: "failed", message: failed.error ?? "Provisioning failed.", createdAt: new Date().toISOString() });
    await deleteUnusedTradingSpannerInstance().catch(() => undefined);
    await recordTransaction({ id: `trading-${id}`, payer: stack.payer, service: "trading", operation: "deploy_paper", status: "failed", requestedAmountUsd: PAPER_TRADING_PROFILE.priceCeilingUsd, resourceId: id, createdAt: now.toISOString(), completedAt: new Date().toISOString(), error: failed.error });
    return NextResponse.json({ error: `Paper trading provisioning failed: ${failed.error}` }, { status: 502 });
  }
}
