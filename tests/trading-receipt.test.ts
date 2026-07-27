import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearPendingTradingRequest, pendingTradingRequestId } from "../src/trading-receipt.js";

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
