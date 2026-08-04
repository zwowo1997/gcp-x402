import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { verifyMoonPayWebhookSignature } from "@/lib/moonpay-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!config.moonPayWebhookKey) return NextResponse.json({ error: "MoonPay webhook is not configured." }, { status: 503 });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 256_000) return NextResponse.json({ error: "Webhook payload too large." }, { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 256_000) return NextResponse.json({ error: "Webhook payload too large." }, { status: 413 });
  if (!verifyMoonPayWebhookSignature(rawBody, request.headers.get("moonpay-signature-v2"), config.moonPayWebhookKey, undefined, config.moonPayWebhookMaxAgeSeconds)) {
    return NextResponse.json({ error: "Invalid MoonPay webhook signature." }, { status: 401 });
  }
  // This beta intentionally records no payment as settled and performs no provisioning.
  // MoonPay retries webhook delivery, so a later production implementation must store an
  // idempotency key before connecting this endpoint to x402 or resource provisioning.
  return NextResponse.json({ received: true, mode: "onramp-observed-only" });
}
