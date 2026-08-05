import assert from "node:assert/strict";
import test from "node:test";
import { renderMoonPayTopup, validateMoonPaySandboxUrl } from "../src/topup.js";

test("MoonPay top-up showcase accepts only the official sandbox host", () => {
  assert.equal(validateMoonPaySandboxUrl("https://buy-sandbox.moonpay.com/?apiKey=pk_test_example").hostname, "buy-sandbox.moonpay.com");
  assert.throws(() => validateMoonPaySandboxUrl("https://buy.moonpay.com/"), /sandbox host/);
  assert.throws(() => validateMoonPaySandboxUrl("https://example.com/"), /sandbox host/);
});

test("MoonPay top-up screen states the hard stop", () => {
  const screen = renderMoonPayTopup({ walletAddress: "0x1234567890123456789012345678901234567890", fiatAmountUsd: 30, asset: "USDC", network: "ethereum-sepolia", checkoutUrl: "https://buy-sandbox.moonpay.com/" });
  assert.match(screen, /MoonPay hosted sandbox/);
  assert.match(screen, /SHOWCASE ONLY/);
  assert.match(screen, /No GCP resource, x402/);
});
