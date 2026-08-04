import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { signMoonPayWidgetQuery, signMoonPayWidgetUrl, verifyMoonPayWebhookSignature } from "../proxy/lib/moonpay-signature.js";

test("MoonPay widget signature matches the official documentation vector", () => {
  const query = "?apiKey=pk_test_DocsVector00&currencyCode=eth&walletAddress=0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";
  assert.equal(signMoonPayWidgetQuery(query, "sk_test_DocsVector00"), "oIJxSghyzll/BLhUFdQZhkxf7DAS8REFaWr/ibO+K8Q=");
  const unsigned = new URL(`https://buy-sandbox.moonpay.com/${query}`);
  assert.equal(signMoonPayWidgetUrl(unsigned, "sk_test_DocsVector00"), `https://buy-sandbox.moonpay.com/${query}&signature=oIJxSghyzll%2FBLhUFdQZhkxf7DAS8REFaWr%2FibO%2BK8Q%3D`);
  assert.throws(() => signMoonPayWidgetQuery(query, "sk_live_not-allowed"), /sk_test_/);
  assert.throws(() => signMoonPayWidgetQuery(query.slice(1), "sk_test_DocsVector00"), /leading/);
  unsigned.searchParams.set("signature", "already-signed");
  assert.throws(() => signMoonPayWidgetUrl(unsigned, "sk_test_DocsVector00"), /exactly once/);
});

test("MoonPay v2 webhook signature requires an untampered recent raw payload", () => {
  const body = '{"type":"transaction_updated","data":{"id":"tx-1"}}';
  const timestamp = 1_700_000_000;
  const secret = "test-webhook-key";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  assert.equal(verifyMoonPayWebhookSignature(body, `t=${timestamp},s=${signature}`, secret, timestamp + 10), true);
  assert.equal(verifyMoonPayWebhookSignature(`${body} `, `t=${timestamp},s=${signature}`, secret, timestamp + 10), false);
  assert.equal(verifyMoonPayWebhookSignature(body, `t=${timestamp - 301},s=${signature}`, secret, timestamp), false);
});
