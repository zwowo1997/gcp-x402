#!/usr/bin/env node
// gcp-x402 MCP server — lets an agent query BigQuery public datasets by paying
// per query in USDC over x402. The agent never needs a Google Cloud account.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { estimate, query, listDatasets, walletInfo, provisionCatalog, provisionResource, provisionStatus, provisionDelete, tradingCatalog, deployPaperTrading, tradingStatus, controlPaperTrading, unlockService, simulateV3Deployment, v3Catalog, v3SimulationStatus, controlV3Simulation, moonPayAvailability, moonPayCheckout, v3TradingCatalog, quoteV3PaperTrading, deployV3PaperTrading, v3TradingStatus, controlV3PaperTrading } from "./client.js";
import { config } from "./config.js";
import { runCli } from "./cli.js";
import { createSandboxPlan, getSandboxPlan, getSandboxReceipt, getSandboxReceiptForPlan, listSandboxReceipts, sandboxAccount, saveSandboxReceipt, updateSandboxReceipt } from "./sandbox.js";
import { paymentProviderInfo } from "./payment-provider.js";
import { openExternalUrl } from "./topup.js";
import { listTradingReceipts } from "./trading-receipt.js";

const server = new McpServer({
  name: "gcp-x402",
  version: "0.1.0",
});

server.registerTool(
  "unlock_service",
  {
    title: "Unlock the private gcp-x402 beta",
    description: "Unlock this MCP process for eight hours with the operator-provided private-beta password. The password is sent only to the unlock endpoint and is never persisted; only the signed session is stored locally.",
    inputSchema: { password: z.string().min(1).max(256).describe("Private-beta password supplied by the operator.") },
  },
  async ({ password }) => {
    const result = await unlockService(password);
    return { content: [{ type: "text", text: `Private beta unlocked until ${result.expiresAt}.` }] };
  },
);

server.registerTool(
  "bigquery_estimate",
  {
    title: "Estimate a BigQuery query cost",
    description:
      "Dry-run a read-only SQL query against BigQuery public datasets and return the exact " +
      "price (USDC) and bytes it will scan — WITHOUT paying or running it. Use this to preview " +
      "cost before calling bigquery_query.",
    inputSchema: { sql: z.string().describe("A read-only BigQuery Standard SQL SELECT query.") },
  },
  async ({ sql }) => {
    const q = await estimate(sql);
    return {
      content: [
        {
          type: "text",
          text:
            `Estimated cost: $${q.priceUsd.toFixed(6)} USDC on ${q.network}\n` +
            `Bytes scanned: ${q.bytes.toLocaleString()}\n` +
            (q.priceUsd > config.maxPaymentUsd
              ? `\n⚠️  Exceeds your MAX_PAYMENT_USD ($${config.maxPaymentUsd}); bigquery_query will refuse it.`
              : ``),
        },
      ],
    };
  },
);

server.registerTool("provision_catalog", { title: "List provisionable GCP resources", description: "List the allowlisted VM and storage profiles, limits, and testing spend caps.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: JSON.stringify(await provisionCatalog(), null, 2) }] }));
server.registerTool("provision_resource", { title: "Provision a GCP resource", description: "Provision an allowlisted ephemeral GCP resource. The request is paid via x402 and automatically expires.", inputSchema: { resourceId: z.enum(["vm.small", "storage.small"]), durationMinutes: z.number().int().min(1).max(60).optional() } }, async ({ resourceId, durationMinutes }) => ({ content: [{ type: "text", text: JSON.stringify(await provisionResource({ resourceId, durationMinutes }), null, 2) }] }));
server.registerTool("provision_status", { title: "Get provisioning status", description: "Get the status of a provisioned resource by job ID and its capability returned at creation.", inputSchema: { jobId: z.string(), capability: z.string() } }, async ({ jobId, capability }) => ({ content: [{ type: "text", text: JSON.stringify(await provisionStatus(jobId, capability), null, 2) }] }));
server.registerTool("provision_delete", { title: "Delete a provisioned resource", description: "Delete a provisioned resource using the capability returned at creation.", inputSchema: { jobId: z.string(), capability: z.string() } }, async ({ jobId, capability }) => ({ content: [{ type: "text", text: JSON.stringify(await provisionDelete(jobId, capability), null, 2) }] }));

server.registerTool("trading_catalog", { title: "List Tokyo paper-trading infrastructure", description: "List the only supported Hyperliquid profile: a one-hour Tokyo BTC paper-trading stack using real market data and simulated orders. It never trades or requires a Hyperliquid account.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: JSON.stringify(await tradingCatalog(), null, 2) }] }));
server.registerTool("trading_deploy_paper", { title: "Deploy a Hyperliquid BTC paper-trading stack", description: "Pay via x402 to create a one-hour Tokyo GCP stack. A recent matching receipt is returned instead of charging again. Set allowAdditionalStack only when the user explicitly requests and freshly approves a separate additional $5 stack. This is permanently paper-only.", inputSchema: { fastEma: z.number().int().min(2).optional(), slowEma: z.number().int().min(3).optional(), virtualBalanceUsd: z.number().positive().optional(), maxOrderNotionalUsd: z.number().positive().optional(), maxPositionNotionalUsd: z.number().positive().optional(), maxDailyLossUsd: z.number().positive().optional(), slippageBps: z.number().min(0).max(100).optional(), allowAdditionalStack: z.boolean().optional().describe("Default false. True only after explicit approval for an additional independent paid stack.") } }, async ({ allowAdditionalStack, ...strategy }) => ({ content: [{ type: "text", text: JSON.stringify(await deployPaperTrading(strategy, { allowAdditionalStack }), null, 2) }] }));
server.registerTool("trading_status", { title: "Inspect a paper-trading stack", description: "Return current GCP resources, paper strategy state, expiry, and audit events. Requires the capability returned on deployment.", inputSchema: { stackId: z.string(), capability: z.string() } }, async ({ stackId, capability }) => ({ content: [{ type: "text", text: JSON.stringify(await tradingStatus(stackId, capability), null, 2) }] }));
server.registerTool("trading_control", { title: "Control a paper-trading stack", description: "Start, stop, resume, or permanently shut down a paper-trading stack. Stop prevents new simulated orders. Shutdown deletes its dedicated runtime resources.", inputSchema: { stackId: z.string(), capability: z.string(), control: z.enum(["start", "stop", "resume", "shutdown"]) } }, async ({ stackId, capability, control }) => ({ content: [{ type: "text", text: JSON.stringify(await controlPaperTrading(stackId, capability, control), null, 2) }] }));

server.registerTool("v3_catalog", { title: "Inspect v3 sandbox payment plans", description: "Show duration-aware AP2-derived, x402-v2-upto payment plans. The private-beta endpoint is simulation-only: it cannot transfer funds or create cloud resources.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: JSON.stringify(await v3Catalog(), null, 2) }] }));
server.registerTool("v3_trading_catalog", { title: "Browse real V3 paper-stack prices", description: "Show 15, 30, and 60-minute Tokyo paper-trading plans, their estimated GCP usage, exact expected testnet-USDC charge, authorization ceiling, and whether deployment is enabled. This does not pay or provision.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: JSON.stringify(await v3TradingCatalog(), null, 2) }] }));
server.registerTool("v3_trading_quote", { title: "Create a signed V3 paper-stack quote", description: "Create a ten-minute signed quote for a duration and paper strategy. This does not authorize payment or provision resources. Show its exact expected charge and cap to the user before requesting approval.", inputSchema: { durationMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]), fastEma: z.number().int().min(2).optional(), slowEma: z.number().int().min(3).max(64).optional(), virtualBalanceUsd: z.number().positive().optional(), maxOrderNotionalUsd: z.number().positive().optional(), maxPositionNotionalUsd: z.number().positive().optional(), maxDailyLossUsd: z.number().positive().optional(), slippageBps: z.number().min(0).max(100).optional() } }, async ({ durationMinutes, ...strategy }) => ({ content: [{ type: "text", text: JSON.stringify(await quoteV3PaperTrading({ durationMinutes, strategy }), null, 2) }] }));
server.registerTool("v3_trading_deploy", { title: "Deploy an approved V3 paper stack", description: "After the user explicitly approves one displayed signed quote, pay exactly its expected Base Sepolia testnet-USDC amount and provision one idempotent paper-only stack. quoteToken, quoteId, durationMinutes, and approvedExpectedChargeUsd must all be from that same fresh quote. The authorization cap is never transferred.", inputSchema: { quoteToken: z.string().min(20).describe("The signed quoteToken returned by v3_trading_quote."), quoteId: z.string().uuid().describe("The quoteId returned by v3_trading_quote and explicitly approved by the user."), durationMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]), approvedExpectedChargeUsd: z.number().positive().describe("The exact expectedChargeUsd the user explicitly approved for this quote."), fastEma: z.number().int().min(2).optional(), slowEma: z.number().int().min(3).max(64).optional(), virtualBalanceUsd: z.number().positive().optional(), maxOrderNotionalUsd: z.number().positive().optional(), maxPositionNotionalUsd: z.number().positive().optional(), maxDailyLossUsd: z.number().positive().optional(), slippageBps: z.number().min(0).max(100).optional() } }, async ({ quoteToken, quoteId, durationMinutes, approvedExpectedChargeUsd, ...strategy }) => ({ content: [{ type: "text", text: JSON.stringify(await deployV3PaperTrading({ quoteToken, quoteId, durationMinutes, approvedExpectedChargeUsd, strategy }), null, 2) }] }));
server.registerTool("v3_trading_status", { title: "Inspect a V3 paper stack", description: "Read a V3 stack's duration, expiry, exact settlement, unused authorization, GCP inventory, telemetry, and events. Requires the returned capability.", inputSchema: { stackId: z.string(), capability: z.string() } }, async ({ stackId, capability }) => ({ content: [{ type: "text", text: JSON.stringify(await v3TradingStatus(stackId, capability), null, 2) }] }));
server.registerTool("v3_trading_control", { title: "Control a V3 paper stack", description: "Stop, resume, or shut down a V3 paper-only stack. Resume never extends its original expiry.", inputSchema: { stackId: z.string(), capability: z.string(), control: z.enum(["start", "stop", "resume", "shutdown"]) } }, async ({ stackId, capability, control }) => ({ content: [{ type: "text", text: JSON.stringify(await controlV3PaperTrading(stackId, capability, control), null, 2) }] }));
server.registerTool("v3_trading_receipts", { title: "List local V3 deployment receipts", description: "List locally stored deployment receipts without capabilities or other bearer secrets. This never starts a payment or deployment.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: JSON.stringify(listTradingReceipts().filter((receipt) => Boolean(receipt.quoteId)).map(({ capability: _capability, ...receipt }) => receipt), null, 2) }] }));
server.registerTool("v3_simulate_deployment", { title: "Prepare a no-money v3 provider showcase", description: "Prepare a protected MoonPay sandbox handoff and resource-plan preview. It creates no payment, cloud resource, or exchange order.", inputSchema: { productId: z.enum(["trading.paper.ema", "vm.small", "storage.small"]), durationMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]) } }, async ({ productId, durationMinutes }) => ({ content: [{ type: "text", text: JSON.stringify(await simulateV3Deployment({ productId, durationMinutes }), null, 2) }] }));
server.registerTool("v3_simulation_status", { title: "Inspect a v3 checkout rehearsal", description: "Read a protected simulation’s mandate, payment, resource plan, expiry, and dashboard link. It is simulation-only.", inputSchema: { stackId: z.string() } }, async ({ stackId }) => ({ content: [{ type: "text", text: JSON.stringify(await v3SimulationStatus(stackId), null, 2) }] }));
server.registerTool("v3_simulation_control", { title: "Advance or control a v3 checkout rehearsal", description: "Simulate explicit approval, sandbox funding, provisioning, stop/resume, shutdown, or cancellation. This never transfers funds or calls GCP.", inputSchema: { stackId: z.string(), action: z.enum(["approve", "fund", "provision", "stop", "resume", "shutdown", "cancel"]) } }, async ({ stackId, action }) => ({ content: [{ type: "text", text: JSON.stringify(await controlV3Simulation(stackId, action), null, 2) }] }));

server.registerTool("sandbox_setup", { title: "Set up a local gcp-x402 sandbox wallet", description: "Create or show a project-local, test-only Base Sepolia wallet with virtual USDC. It never submits a transaction, funds a wallet, or creates cloud infrastructure.", inputSchema: {} }, async () => {
  const wallet = sandboxAccount();
  return { content: [{ type: "text", text: JSON.stringify({ mode: "sandbox", wallet: { address: wallet.address, network: wallet.network, virtualUsdcBalance: wallet.virtualUsdcBalance }, provider: paymentProviderInfo(config.paymentProvider), safety: "No real funds or resources are created." }, null, 2) }] };
});
server.registerTool("sandbox_catalog", { title: "Browse safe GCP sandbox plans", description: "List the allowlisted GCP plans, price estimates, provider boundary, and sandbox safety notices. Unlock first if the service asks for it.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: JSON.stringify({ provider: paymentProviderInfo(config.paymentProvider), catalog: await v3Catalog(), safety: "Simulation-only catalog; no resources can be created." }, null, 2) }] }));
server.registerTool("sandbox_plan", { title: "Plan GCP infrastructure from a natural-language intent", description: "Turn a request such as a Hyperliquid BTC paper-trading stack, a VM, or storage into one local allowlisted sandbox plan. It does not charge, create a checkout, or provision anything.", inputSchema: { intent: z.string().min(3).max(2_000) } }, async ({ intent }) => ({ content: [{ type: "text", text: JSON.stringify(createSandboxPlan(intent), null, 2) }] }));
server.registerTool("sandbox_checkout", { title: "Open one protected sandbox checkout", description: "Create one idempotent checkout rehearsal for a local sandbox plan. Requires the private beta session. With an operator-configured MoonPay test key, it also returns MoonPay's hosted Ethereum Sepolia test checkout; it never provisions or settles in this beta.", inputSchema: { planId: z.string() } }, async ({ planId }) => {
  const plan = getSandboxPlan(planId); if (!plan) throw new Error("Sandbox plan not found in this project directory.");
  const existing = getSandboxReceiptForPlan(plan.planId);
  if (existing) {
    const simulation = await v3SimulationStatus(existing.stackId);
    const availability = await moonPayAvailability();
    const moonpay = availability.enabled ? await moonPayCheckout(existing.stackId) : undefined;
    return { content: [{ type: "text", text: JSON.stringify({ receipt: existing, simulation, moonpay, reusedReceipt: true, reuseReason: "This plan already has a checkout. Create a new plan to intentionally start another." }, null, 2) }] };
  }
  const simulation = await simulateV3Deployment({ productId: plan.productId, durationMinutes: plan.durationMinutes, payer: plan.walletAddress, requestId: plan.planId });
  const stackId = String(simulation.stackId);
  const receipt = saveSandboxReceipt({ checkoutId: `checkout-${stackId}`, planId: plan.planId, stackId, createdAt: new Date().toISOString(), dashboardUrl: typeof simulation.dashboardUrl === "string" ? simulation.dashboardUrl : undefined, status: String(simulation.status ?? "checkout"), paymentStatus: String(simulation.paymentStatus ?? "not_authorized"), trace: [{ at: new Date().toISOString(), event: "quote_created", detail: `Plan ${plan.planId} prepared.` }, { at: new Date().toISOString(), event: "checkout_opened", detail: "No card, USDC, or cloud resource was used." }] });
  const availability = await moonPayAvailability();
  const moonpay = availability.enabled ? await moonPayCheckout(stackId) : undefined;
  return { content: [{ type: "text", text: JSON.stringify({ receipt, simulation, moonpay }, null, 2) }] };
});
server.registerTool("sandbox_status", { title: "Read a sandbox checkout and payment trace", description: "Read the latest protected checkout simulation state plus the local payment trace. It never starts a new checkout or payment.", inputSchema: { checkoutId: z.string() } }, async ({ checkoutId }) => {
  const receipt = getSandboxReceipt(checkoutId); if (!receipt) throw new Error("Sandbox receipt not found in this project directory.");
  const simulation = await v3SimulationStatus(receipt.stackId);
  const refreshed = updateSandboxReceipt(receipt.checkoutId, { status: String(simulation.status ?? "unknown"), paymentStatus: String(simulation.paymentStatus ?? "unknown"), dashboardUrl: typeof simulation.dashboardUrl === "string" ? simulation.dashboardUrl : receipt.dashboardUrl, event: "status_observed", detail: `Simulation reported ${String(simulation.status ?? "unknown")}.` }) ?? receipt;
  return { content: [{ type: "text", text: JSON.stringify({ receipt: refreshed, simulation, allReceipts: listSandboxReceipts().length }, null, 2) }] };
});

server.registerTool("moonpay_showcase", { title: "Open the hosted MoonPay sandbox showcase", description: "After the user chooses the real-money on-ramp showcase, create one local simulation plan, obtain MoonPay's official hosted sandbox URL, and open it from this MCP session. The tool always returns the URL even if desktop launch is unavailable. It stops before payment, x402 settlement, GCP provisioning, dashboard creation, or trading.", inputSchema: { intent: z.string().min(3).max(2_000), durationMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(15), openBrowser: z.boolean().default(true) } }, async ({ intent, durationMinutes, openBrowser }) => {
  const plan = createSandboxPlan(intent, { durationMinutes });
  const existing = getSandboxReceiptForPlan(plan.planId);
  const simulation = existing
    ? await v3SimulationStatus(existing.stackId)
    : await simulateV3Deployment({ productId: plan.productId, durationMinutes: plan.durationMinutes, payer: plan.walletAddress, requestId: plan.planId });
  if (!existing) saveSandboxReceipt({ checkoutId: `checkout-${simulation.stackId}`, planId: plan.planId, stackId: simulation.stackId, createdAt: new Date().toISOString(), status: String(simulation.status ?? "checkout"), paymentStatus: String(simulation.paymentStatus ?? "not_authorized"), trace: [{ at: new Date().toISOString(), event: "moonpay_showcase_created", detail: "MoonPay sandbox handoff prepared; no payment or infrastructure action was started." }] });
  const availability = await moonPayAvailability();
  if (!availability.enabled) throw new Error(availability.note);
  const moonpay = await moonPayCheckout(simulation.stackId);
  let browserOpened = false;
  let browserNote = "Browser opening was not requested.";
  if (openBrowser) {
    try { openExternalUrl(moonpay.checkoutUrl); browserOpened = true; browserNote = "MoonPay sandbox was opened by the local MCP process."; }
    catch (error) { browserNote = (error as Error).message; }
  }
  return { content: [{ type: "text", text: JSON.stringify({ mode: "moonpay-sandbox-showcase", checkoutUrl: moonpay.checkoutUrl, browserOpened, browserNote, walletAddress: plan.walletAddress, network: moonpay.network, asset: moonpay.asset, stopAfterRedirect: true, safety: "No payment result is consumed and no GCP resource or trade can follow." }, null, 2) }] };
});

server.registerTool(
  "bigquery_query",
  {
    title: "Run a BigQuery query (pays per query in USDC)",
    description:
      "Run a read-only SQL query against BigQuery public datasets. Automatically pays the " +
      "per-query price in USDC via x402 and returns the result rows. You are only charged if " +
      "the query succeeds. Only bigquery-public-data tables are queryable; DML/DDL is rejected. " +
      "Consider bigquery_estimate first for expensive-looking queries.",
    inputSchema: { sql: z.string().describe("A read-only BigQuery Standard SQL SELECT query.") },
  },
  async ({ sql }) => {
    const result = await query(sql);
    const b = result.billing as Record<string, unknown>;
    const summary =
      `${result.rowCount} row(s)${result.truncated ? " (truncated)" : ""} · ` +
      `paid $${Number(b.pricePaidUsd ?? 0).toFixed(6)} USDC · ` +
      `${Number(b.bytesScanned ?? 0).toLocaleString()} bytes scanned` +
      (b.cacheHit ? " · cache hit" : "");
    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: JSON.stringify(result.rows, null, 2) },
      ],
    };
  },
);

server.registerTool(
  "wallet_info",
  {
    title: "Show the agent's wallet address and USDC balance",
    description:
      "Return this agent's payment wallet address, its current USDC balance, and funding " +
      "instructions. Call this when a query fails for insufficient funds, or to ask the user " +
      "to top up the wallet. The wallet is generated automatically on first run.",
    inputSchema: {},
  },
  async () => {
    const info = await walletInfo();
    return {
      content: [
        {
          type: "text",
          text:
            `Wallet address: ${info.address}\n` +
            `Network: ${info.network}\n` +
            `USDC balance: ${info.usdcBalance}\n\n` +
            `To add funds: ${info.fundingHint}`,
        },
      ],
    };
  },
);

server.registerTool(
  "list_public_datasets",
  {
    title: "List popular BigQuery public datasets",
    description:
      "Return a curated list of popular BigQuery public datasets you can query, plus current pricing.",
    inputSchema: {},
  },
  async () => {
    const data = await listDatasets();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

async function main() {
  // Dual mode: with args, behave as a plain CLI (used by the skill over Bash);
  // with no args, run as an MCP server over stdio (used by MCP clients).
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0) {
    // Do not call process.exit() here: stdout may still be buffered when another
    // agent redirects the JSON result, which can discard a newly issued capability.
    process.exitCode = await runCli(cliArgs);
    return;
  }

  // Diagnostics go to stderr — stdout is the MCP transport.
  console.error(`gcp-x402 MCP server — proxy ${config.proxyUrl}. A payment wallet is created only when a paid tool or wallet_info is used.`);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
