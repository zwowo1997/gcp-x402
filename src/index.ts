#!/usr/bin/env node
// gcp-x402 MCP server — lets an agent query BigQuery public datasets by paying
// per query in USDC over x402. The agent never needs a Google Cloud account.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { estimate, query, listDatasets, walletInfo, walletAddress, provisionCatalog, provisionResource, provisionStatus, provisionDelete, tradingCatalog, deployPaperTrading, tradingStatus, controlPaperTrading, unlockService } from "./client.js";
import { freshlyCreated } from "./wallet.js";
import { config } from "./config.js";
import { runCli } from "./cli.js";

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
  console.error(`gcp-x402 MCP server — wallet ${walletAddress}, proxy ${config.proxyUrl}`);
  if (freshlyCreated) {
    console.error(
      `\n  🪙  A new wallet was generated and saved to ${config.walletFile}.\n` +
        `      Fund ${walletAddress} with USDC on Base to start querying.\n` +
        `      The agent can show this anytime via the wallet_info tool.\n`,
    );
  }
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
