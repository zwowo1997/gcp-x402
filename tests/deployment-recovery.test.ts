import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DEPLOYMENT_TIMEOUT_MS } from "../src/network.js";

test("V3 deployment keeps client and MCP deadlines above observed provisioning latency", async () => {
  assert.equal(DEPLOYMENT_TIMEOUT_MS, 180_000);
  const launcher = await readFile("src/launcher.ts", "utf8");
  assert.match(launcher, /tool_timeout_sec=180/);
});

test("V3 server reconciles a signed request before rejecting an expired quote", async () => {
  const route = await readFile("proxy/app/api/v3/trading/deploy/route.ts", "utf8");
  const authenticate = route.indexOf("authenticateV3TradingQuoteToken(body.quoteToken");
  const recover = route.indexOf("findTradingStackByRequestKey(authenticatedQuote.requestId)");
  const enforceExpiry = route.indexOf("verifyV3TradingQuoteToken(body.quoteToken");
  assert.ok(authenticate >= 0 && recover > authenticate && enforceExpiry > recover);
  assert.match(route, /if \(existing\) return existingResponse/);
});

test("trading runtime services are provisioned concurrently", async () => {
  const provisioning = await readFile("proxy/lib/trading/provisioning.ts", "utf8");
  assert.match(provisioning, /Promise\.allSettled\(\[\s*createService\(resources\.writerService[\s\S]*createService\(resources\.collectorService/);
});
