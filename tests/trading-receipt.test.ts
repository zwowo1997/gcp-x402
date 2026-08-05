import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearPendingTradingRequest, pendingTradingRequestId, publicTradingReceipt, recentTradingReceipt, type TradingReceipt } from "../src/trading-receipt.js";

test("paid deployment retries reuse their pending request ID", () => {
  const directory = mkdtempSync(join(tmpdir(), "gcp-x402-pending-"));
  const file = join(directory, "pending.json");
  let issued = 0;
  const createId = () => `request-${++issued}`;

  const first = pendingTradingRequestId({ symbol: "BTC" }, createId, file);
  const retry = pendingTradingRequestId({ symbol: "BTC" }, createId, file);
  assert.equal(first, "request-1");
  assert.equal(retry, first);
  assert.equal(issued, 1);
  assert.equal(JSON.parse(readFileSync(file, "utf8"))[0].requestId, first);
});

test("confirmed outcomes clear pending request IDs", () => {
  const directory = mkdtempSync(join(tmpdir(), "gcp-x402-pending-"));
  const file = join(directory, "pending.json");
  const first = pendingTradingRequestId({}, () => "request-1", file);
  clearPendingTradingRequest(first, file);
  const next = pendingTradingRequestId({}, () => "request-2", file);
  assert.equal(next, "request-2");
});

test("a recent matching success blocks accidental handoff redeployment", () => {
  const directory = mkdtempSync(join(tmpdir(), "gcp-x402-receipt-"));
  const file = join(directory, "receipts.json");
  const receipt: TradingReceipt = {
    stackId: "stack-1", mode: "paper", region: "asia-northeast1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), maxPriceUsd: 5,
    capability: "private", paperOnly: true, configJson: "{}", savedAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify([receipt]));
  assert.equal(recentTradingReceipt({}, 30 * 60_000, file)?.stackId, "stack-1");
});

test("public receipt views never expose capabilities or dashboard fragment secrets", () => {
  const receipt: TradingReceipt = {
    stackId: "stack-1", mode: "paper", region: "asia-northeast1",
    expiresAt: "2099-01-01T00:00:00.000Z", maxPriceUsd: 0.15,
    capability: "capability-secret", paperOnly: true,
    dashboardUrl: "https://dashboard.example/strategy/stack-1#capability=capability-secret&session=session-secret",
    savedAt: "2026-08-04T00:00:00.000Z",
  };
  const publicReceipt = publicTradingReceipt(receipt);
  assert.equal(publicReceipt.dashboardUrl, "https://dashboard.example/strategy/stack-1");
  assert.ok(!JSON.stringify(publicReceipt).includes("capability-secret"));
  assert.ok(!JSON.stringify(publicReceipt).includes("session-secret"));
  assert.ok(!("capability" in publicReceipt));
});
