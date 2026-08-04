import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_FUTURE_SKEW_SECONDS = 60;

/** Sign the final, encoded MoonPay query string, including its leading `?`. */
export function signMoonPayWidgetQuery(search: string, secretKey: string): string {
  if (!search.startsWith("?") || search.length < 2) throw new Error("MoonPay signing requires a non-empty query string including the leading ?.");
  if (!secretKey.startsWith("sk_test_")) throw new Error("V3 accepts only a MoonPay sk_test_ secret key.");
  return createHmac("sha256", secretKey).update(search, "utf8").digest("base64");
}

export function signMoonPayWidgetUrl(unsignedUrl: URL, secretKey: string): string {
  if (unsignedUrl.searchParams.has("signature")) throw new Error("MoonPay URL must be signed exactly once.");
  const signature = signMoonPayWidgetQuery(unsignedUrl.search, secretKey);
  return `${unsignedUrl.toString()}&signature=${encodeURIComponent(signature)}`;
}

export function verifyMoonPayWebhookSignature(rawBody: string, header: string | null, webhookKey: string, nowSeconds = Math.floor(Date.now() / 1000), maxAgeSeconds = 5 * 60): boolean {
  if (!header || !webhookKey) return false;
  const values: Record<string, string> = {};
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator > 0) values[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  const timestamp = Number(values.t);
  const signature = values.s;
  if (!Number.isInteger(timestamp) || !signature || !/^[a-f0-9]{64}$/i.test(signature) || maxAgeSeconds <= 0 || timestamp > nowSeconds + MAX_FUTURE_SKEW_SECONDS || nowSeconds - timestamp > maxAgeSeconds) return false;
  const expected = createHmac("sha256", webhookKey).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const actual = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}
