import assert from "node:assert/strict";
import test from "node:test";
import { codexLaunchArguments, nativeSessionEnvironment, nativeStateDirectory, NATIVE_MCP_TOOLS } from "../src/launcher.js";
import { isV3TradingReceipt } from "../src/trading-receipt.js";

test("native launcher uses one explicit machine-level state directory", () => {
  const env = { GCP_X402_HOME: "/tmp/gcp-x402-native" };
  assert.equal(nativeStateDirectory(env), "/tmp/gcp-x402-native");
  const child = nativeSessionEnvironment(env);
  assert.equal(child.WALLET_FILE, "/tmp/gcp-x402-native/wallet.json");
  assert.equal(child.GCP_X402_BETA_SESSION_FILE, "/tmp/gcp-x402-native/beta-session.json");
});

test("only complete V3 receipts can suppress a repeated paid deployment", () => {
  const base = { stackId: "stack", mode: "paper" as const, region: "asia-northeast1", expiresAt: "2099-01-01T00:00:00.000Z", maxPriceUsd: 0.15, capability: "cap", paperOnly: true as const, savedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(isV3TradingReceipt(base), false);
  assert.equal(isV3TradingReceipt({ ...base, quoteId: "quote", durationMinutes: 15, expectedChargeUsd: 0.09, authorizationCapUsd: 0.15, settledAmountUsd: 0.09, unusedAuthorizationUsd: 0.06 }), true);
});

test("native Codex session injects the unified V3 and MoonPay-capable MCP", () => {
  const args = codexLaunchArguments("/opt/gcp-x402/dist/index.js", ["--model", "test"], "https://preview.example.run.app");
  const rendered = args.join(" ");
  for (const tool of ["unlock_service", "v3_trading_catalog", "v3_trading_quote", "v3_trading_deploy", "moonpay_showcase", "sandbox_checkout"]) assert.match(rendered, new RegExp(tool));
  assert.match(rendered, /mcp_servers\.gcp_x402\.env\.PROXY_URL=.*preview\.example\.run\.app/);
  assert.deepEqual(args.slice(-2), ["--model", "test"]);
  assert.ok(NATIVE_MCP_TOOLS.includes("wallet_info"));
});
