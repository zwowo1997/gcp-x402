// POST /api/query — the x402-gated BigQuery endpoint.
//
// Two-call handshake:
//   Call 1 (no X-PAYMENT):  dry-run -> price -> 402 + signed quote
//   Call 2 (with X-PAYMENT): re-dry-run -> verify -> execute(capped) -> settle -> 200
//
// The re-dry-run on call 2 is the authoritative anti-tamper check: with the
// `exact` scheme the payment authorizes exactly the quoted amount, so a swapped
// (larger) body re-prices higher and the facilitator's /verify rejects it.

import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { dryRun, execute, QueryRejected } from "@/lib/bigquery";
import { priceQuery, formatUsd } from "@/lib/pricing";
import { signQuote, sha256 } from "@/lib/quote";
import {
  buildRequirements,
  paymentRequiredBody,
  decodePaymentHeader,
  verify,
  settle,
  encodeSettlementHeader,
} from "@/lib/x402";
import { recordTransaction } from "@/lib/store";
import { requireBetaSession } from "@/lib/beta";

export const runtime = "nodejs";
export const maxDuration = 120;

interface QueryBody {
  sql?: string;
  query?: string; // alias
}

export async function POST(req: NextRequest) {
  const locked = requireBetaSession(req);
  if (locked) return locked;
  // --- parse ---------------------------------------------------------------
  let body: QueryBody;
  try {
    body = (await req.json()) as QueryBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { sql: string }" }, { status: 400 });
  }
  const sql = (body.sql ?? body.query ?? "").trim();
  if (!sql) {
    return NextResponse.json({ error: "Missing `sql` in request body." }, { status: 400 });
  }

  // Behind a proxy/load balancer (Cloud Run), req.url carries the internal
  // host (0.0.0.0:8080). Derive the public URL from the forwarded headers so the
  // x402 `resource` is correct (works for the run.app host and custom domains).
  const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  const resource = fwdHost ? `${fwdProto}://${fwdHost}/api/query` : new URL(req.url).toString();

  // --- price (dry run is the oracle for both calls) ------------------------
  let quote;
  try {
    const dry = await dryRun(sql);
    quote = priceQuery(dry.bytes, dry.referencedTables.length);
  } catch (e) {
    if (e instanceof QueryRejected) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: `Dry run failed: ${(e as Error).message}` }, { status: 502 });
  }

  const exp = Math.floor(Date.now() / 1000) + config.quoteTtlSeconds;
  const quoteToken = signQuote({
    qhash: sha256(sql),
    bytes: quote.bytes,
    priceBaseUnits: quote.priceBaseUnits,
    exp,
  });

  const requirements = buildRequirements({
    maxAmountRequired: quote.priceBaseUnits,
    resource,
    description:
      `BigQuery: ${quote.bytes.toLocaleString()} bytes scanned, ` +
      `${formatUsd(quote.priceUsd)} on ${config.network.id}`,
    quoteToken,
  });

  // --- call 1: no payment yet -> 402 ---------------------------------------
  const paymentHeader = req.headers.get("x-payment");
  if (!paymentHeader) {
    return NextResponse.json(paymentRequiredBody(requirements), { status: 402 });
  }

  // --- call 2: verify the payment against the freshly-priced requirements ---
  let payment;
  try {
    payment = decodePaymentHeader(paymentHeader);
  } catch {
    return NextResponse.json(
      paymentRequiredBody(requirements, "Malformed X-PAYMENT header."),
      { status: 402 },
    );
  }

  let verifyResult;
  try {
    verifyResult = await verify(payment, requirements);
  } catch (e) {
    return NextResponse.json({ error: `Payment verification error: ${(e as Error).message}` }, { status: 502 });
  }
  if (!verifyResult.isValid) {
    // Most commonly: the body changed (so the re-priced amount no longer matches
    // the authorized amount), or the quote/authorization expired -> re-quote.
    return NextResponse.json(
      paymentRequiredBody(requirements, verifyResult.invalidReason ?? "Payment invalid; re-quote and retry."),
      { status: 402 },
    );
  }

  // --- execute (hard byte cap) ---------------------------------------------
  let result;
  try {
    result = await execute(sql, quote.billableBytes);
  } catch (e) {
    // Query failed (incl. a cap breach) -> we DO NOT settle, so the agent is not
    // charged. They can re-quote and retry.
    const msg = (e as Error).message;
    const capped = /maximum.*bytes.*billed|exceeded limit/i.test(msg);
    return NextResponse.json(
      { error: capped ? "Query exceeded its quoted byte cap; re-quote and retry." : `Query failed: ${msg}` },
      { status: capped ? 402 : 500 },
    );
  }

  // --- settle (only now that the query succeeded) --------------------------
  let settlement;
  try {
    settlement = await settle(payment, requirements);
  } catch (e) {
    return NextResponse.json({ error: `Settlement error: ${(e as Error).message}` }, { status: 502 });
  }
  if (!settlement.success) {
    return NextResponse.json(
      { error: `Settlement failed: ${settlement.errorReason ?? "unknown"}` },
      { status: 402 },
    );
  }

  // --- success -------------------------------------------------------------
  const res = NextResponse.json({
    rows: result.rows,
    rowCount: result.rows.length,
    truncated: result.truncated,
    maxInlineRows: config.maxInlineRows,
    billing: {
      bytesScanned: quote.bytes,
      bytesBilled: result.bytesBilled,
      cacheHit: result.cacheHit,
      pricePaidUsd: quote.priceUsd,
      priceBaseUnits: quote.priceBaseUnits,
      asset: "USDC",
      network: config.network.id,
    },
  });
  res.headers.set("X-PAYMENT-RESPONSE", encodeSettlementHeader(settlement));
  void recordTransaction({
    id: `bigquery-${sha256(`${sql}:${Date.now()}:${verifyResult.payer ?? "unknown"}`)}`,
    payer: verifyResult.payer ?? "unknown",
    service: "bigquery",
    operation: "query",
    status: "settled",
    requestedAmountUsd: quote.priceUsd,
    settledAmountUsd: quote.priceUsd,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
  return res;
}
