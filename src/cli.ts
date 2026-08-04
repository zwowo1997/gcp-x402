// CLI mode for the gcp-x402 binary.
//
// The same package is both an MCP server (no args) and a plain CLI (with args),
// so a skill can drive it over Bash via `npx -y <repo> <command>` without any
// MCP registration. Output is written for an agent to read: a human-readable
// summary on stderr, the actual data (rows / json) on stdout.

import { estimate, query, listDatasets, walletInfo, provisionCatalog, provisionResource, provisionStatus, provisionDelete, tradingCatalog, deployPaperTrading, tradingStatus, controlPaperTrading, unlockService, simulateV3Deployment, v3Catalog, v3SimulationStatus, controlV3Simulation } from "./client.js";
import { config } from "./config.js";
import { getTradingReceipt, listTradingReceipts } from "./trading-receipt.js";
import { createSandboxPlan, getSandboxPlan, getSandboxReceipt, listSandboxReceipts, sandboxAccount, saveSandboxReceipt, updateSandboxReceipt } from "./sandbox.js";
import { paymentProviderInfo } from "./payment-provider.js";
import { spawnSync } from "node:child_process";

const USAGE = `gcp-x402 — query BigQuery public datasets, paid per query in USDC (x402)

Usage:
  npx -y github:zwowo1997/gcp-x402 <command>

Commands:
  unlock                 Prompt for the private-beta password and save only the session.
  wallet                 Show this project's wallet address, USDC balance, and how to fund it.
  estimate "<sql>"       Dry-run a query: exact price + bytes, without paying or running it.
  query "<sql>"          Run a read-only query, auto-pay the USDC price, print the rows.
  datasets               List popular public datasets and current pricing.
  catalog                List provisionable GCP resource profiles.
  provision <resource>  Provision vm.small or storage.small and pay via x402.
  provision-status <id> <capability> Show a provisioning job.
  provision-delete <id> <capability> Delete a provisioned resource.
  trading-catalog         List the Tokyo paper-trading stack profile.
  trading-deploy          Deploy once, or recover a recent matching receipt without paying again.
  trading-deploy --new    Intentionally deploy an additional paid stack after fresh approval.
  trading-status <id> <capability> Inspect a paper-trading stack.
  trading-control <id> <capability> <start|stop|resume|shutdown> Control a paper-trading stack.
  trading-receipt <id>   Recover a locally saved paid trading receipt/capability.
  trading-receipts       List locally saved trading deployment receipts.
  v3-catalog             Show the v3 duration-aware, simulation-only payment plans.
  v3-simulate <product> <15|30|60>
                         Preview AP2-derived mandate, Coinbase sandbox handoff, and resources.
  v3-status <stack-id>   Inspect a protected checkout simulation.
  v3-control <stack-id> <approve|fund|provision|stop|resume|shutdown|cancel>
                         Advance or control a protected checkout simulation.
  setup --sandbox        Create a local, test-only Base Sepolia wallet and show the safe workflow.
  sandbox catalog        Browse the safe GCP sandbox catalog and price plans.
  plan "<intent>"        Turn a natural-language request into one allowlisted sandbox plan.
  checkout <plan-id>     Create one protected checkout from a sandbox plan (requires unlock).
  status <checkout-id>   Show the checkout, payment trace, and simulated infrastructure state.
  receipts               List local sandbox checkout receipts without secrets.
  debugger <checkout-id> Print the trace and dashboard URL for a sandbox checkout.
  codex                  Launch Codex with the gcp-x402 MCP server injected for this session.
  help                   Show this message.

Only bigquery-public-data tables are queryable; read-only (no DML/DDL).`;

export async function runCli(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const sql = argv.slice(1).join(" ").trim();

  switch (cmd) {
    case "setup": {
      if (argv[1] !== "--sandbox") return usageError("setup --sandbox");
      const account = sandboxAccount();
      const provider = paymentProviderInfo(config.paymentProvider);
      console.log(JSON.stringify({ mode: "sandbox", wallet: { address: account.address, network: account.network, virtualUsdcBalance: account.virtualUsdcBalance }, provider, next: ["gcp-x402 sandbox catalog", "gcp-x402 plan \"Build a Hyperliquid BTC paper-trading stack\"", "gcp-x402 checkout <plan-id> (after unlock)"], safety: "Test-only wallet. No funds, Cloud resources, or trades are created." }, null, 2));
      return 0;
    }
    case "sandbox":
      return runSandbox(argv.slice(1));
    case "plan": {
      const plan = createSandboxPlan(sql);
      console.log(JSON.stringify(plan, null, 2));
      return 0;
    }
    case "checkout": {
      if (!argv[1]) return usageError("checkout <plan-id>");
      const plan = getSandboxPlan(argv[1]); if (!plan) return usageError(`No local sandbox plan found for ${argv[1]}`);
      if (plan.provider.id !== "simulator") throw new Error("MoonPay test checkout is not configured yet. Set GCP_X402_PAYMENT_PROVIDER=simulator for the safe local rehearsal.");
      const simulation = await simulateV3Deployment({ productId: plan.productId, durationMinutes: plan.durationMinutes, payer: plan.walletAddress });
      const stackId = String(simulation.stackId);
      const receipt = saveSandboxReceipt({ checkoutId: `checkout-${stackId}`, planId: plan.planId, stackId, createdAt: new Date().toISOString(), dashboardUrl: typeof simulation.dashboardUrl === "string" ? simulation.dashboardUrl : undefined, status: String(simulation.status ?? "checkout"), paymentStatus: String(simulation.paymentStatus ?? "not_authorized"), trace: [{ at: new Date().toISOString(), event: "quote_created", detail: `Plan ${plan.planId} priced at $${plan.quote.expectedChargeUsd.toFixed(2)} maximum simulated settlement.` }, { at: new Date().toISOString(), event: "checkout_opened", detail: "Sandbox checkout created. No card, USDC, or cloud resource was used." }] });
      console.log(JSON.stringify({ receipt, simulation }, null, 2));
      return 0;
    }
    case "status":
    case "debugger": {
      if (!argv[1]) return usageError(`${cmd} <checkout-id>`);
      const receipt = getSandboxReceipt(argv[1]); if (!receipt) return usageError(`No local sandbox receipt found for ${argv[1]}`);
      const simulation = await v3SimulationStatus(receipt.stackId);
      const refreshed = updateSandboxReceipt(receipt.checkoutId, { status: String(simulation.status ?? "unknown"), paymentStatus: String(simulation.paymentStatus ?? "unknown"), dashboardUrl: typeof simulation.dashboardUrl === "string" ? simulation.dashboardUrl : receipt.dashboardUrl, event: "status_observed", detail: `Simulation reported ${String(simulation.status ?? "unknown")}.` }) ?? receipt;
      console.log(JSON.stringify(cmd === "debugger" ? { trace: refreshed.trace, dashboardUrl: refreshed.dashboardUrl, simulation } : { receipt: refreshed, simulation }, null, 2));
      return 0;
    }
    case "receipts":
      console.log(JSON.stringify(listSandboxReceipts(), null, 2));
      return 0;
    case "codex":
      return launchCodex(argv.slice(1));
    case "unlock": {
      const password = await readHiddenPassword();
      if (!password) return usageError("unlock");
      const result = await unlockService(password);
      console.log(`unlocked_until: ${result.expiresAt}`);
      console.log(`project_directory: ${process.cwd()}`);
      console.log(`session_file: ${config.betaSessionFile}`);
      return 0;
    }
    case "wallet": {
      const info = await walletInfo();
      console.log(`address:      ${info.address}`);
      console.log(`network:      ${info.network}`);
      console.log(`usdc_balance: ${info.usdcBalance}`);
      console.log(`funding:      ${info.fundingHint}`);
      return 0;
    }

    case "estimate": {
      if (!sql) return usageError('estimate "<sql>"');
      const q = await estimate(sql);
      console.log(`price_usd: ${q.priceUsd}`);
      console.log(`bytes_scanned: ${q.bytes}`);
      console.log(`network: ${q.network}`);
      return 0;
    }

    case "query": {
      if (!sql) return usageError('query "<sql>"');
      const res = await query(sql);
      const b = res.billing as Record<string, unknown>;
      console.error(
        `paid $${Number(b.pricePaidUsd ?? 0).toFixed(6)} USDC | ` +
          `${res.rowCount} row(s)${res.truncated ? " (truncated)" : ""} | ` +
          `${Number(b.bytesScanned ?? 0).toLocaleString()} bytes scanned` +
          (b.cacheHit ? " | cache hit" : ""),
      );
      console.log(JSON.stringify(res.rows, null, 2));
      return 0;
    }

    case "datasets":
      console.log(JSON.stringify(await listDatasets(), null, 2));
      return 0;

    case "catalog":
      console.log(JSON.stringify(await provisionCatalog(), null, 2));
      return 0;
    case "provision": {
      const resourceId = argv[1] as "vm.small" | "storage.small";
      if (!resourceId) return usageError("provision <vm.small|storage.small>");
      console.log(JSON.stringify(await provisionResource({ resourceId }), null, 2));
      return 0;
    }
    case "provision-status":
      if (!argv[1] || !argv[2]) return usageError("provision-status <job-id> <capability>");
      console.log(JSON.stringify(await provisionStatus(argv[1], argv[2]), null, 2));
      return 0;
    case "provision-delete":
      if (!argv[1] || !argv[2]) return usageError("provision-delete <job-id> <capability>");
      console.log(JSON.stringify(await provisionDelete(argv[1], argv[2]), null, 2));
      return 0;
    case "trading-catalog":
      console.log(JSON.stringify(await tradingCatalog(), null, 2));
      return 0;
    case "trading-deploy":
      if (argv[1] && argv[1] !== "--new") return usageError("trading-deploy [--new]");
      console.log(JSON.stringify(await deployPaperTrading({}, { allowAdditionalStack: argv[1] === "--new" }), null, 2));
      return 0;
    case "trading-status":
      if (!argv[1] || !argv[2]) return usageError("trading-status <stack-id> <capability>");
      console.log(JSON.stringify(await tradingStatus(argv[1], argv[2]), null, 2));
      return 0;
    case "trading-receipt": {
      if (!argv[1]) return usageError("trading-receipt <stack-id>");
      const receipt = getTradingReceipt(argv[1]);
      if (!receipt) return usageError(`No local receipt found for ${argv[1]}`);
      console.log(JSON.stringify(receipt, null, 2));
      return 0;
    }
    case "trading-receipts":
      console.log(JSON.stringify(listTradingReceipts().map(({ capability: _capability, ...receipt }) => receipt), null, 2));
      return 0;
    case "trading-control":
      if (!argv[1] || !argv[2] || !argv[3]) return usageError("trading-control <stack-id> <capability> <start|stop|resume|shutdown>");
      console.log(JSON.stringify(await controlPaperTrading(argv[1], argv[2], argv[3] as "start" | "stop" | "resume" | "shutdown"), null, 2));
      return 0;
    case "v3-catalog":
      console.log(JSON.stringify(await v3Catalog(), null, 2));
      return 0;
    case "v3-simulate": {
      const productId = argv[1] as "trading.paper.ema" | "vm.small" | "storage.small";
      const durationMinutes = Number(argv[2]);
      if (!productId || !["trading.paper.ema", "vm.small", "storage.small"].includes(productId) || ![15, 30, 60].includes(durationMinutes)) {
        return usageError("v3-simulate <trading.paper.ema|vm.small|storage.small> <15|30|60>");
      }
      console.log(JSON.stringify(await simulateV3Deployment({ productId, durationMinutes: durationMinutes as 15 | 30 | 60 }), null, 2));
      return 0;
    }
    case "v3-status":
      if (!argv[1]) return usageError("v3-status <stack-id>");
      console.log(JSON.stringify(await v3SimulationStatus(argv[1]), null, 2));
      return 0;
    case "v3-control": {
      const action = argv[2] as "approve" | "fund" | "provision" | "stop" | "resume" | "shutdown" | "cancel";
      if (!argv[1] || !["approve", "fund", "provision", "stop", "resume", "shutdown", "cancel"].includes(action)) return usageError("v3-control <stack-id> <approve|fund|provision|stop|resume|shutdown|cancel>");
      console.log(JSON.stringify(await controlV3Simulation(argv[1], action), null, 2));
      return 0;
    }

    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(USAGE);
      return 0;

    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.error(USAGE);
      return 2;
  }
}

async function runSandbox(argv: string[]): Promise<number> {
  switch (argv[0]) {
    case "catalog":
      console.log(JSON.stringify({ provider: paymentProviderInfo(config.paymentProvider), wallet: sandboxAccount(), catalog: await v3Catalog(), safety: "Every item below is a simulation-only plan. No cloud resources are provisioned." }, null, 2)); return 0;
    case "plan":
      return runCli(["plan", ...argv.slice(1)]);
    case "checkout":
      return runCli(["checkout", ...argv.slice(1)]);
    case "status": case "debugger":
      return runCli([argv[0], ...argv.slice(1)]);
    case "receipts":
      return runCli(["receipts"]);
    default:
      return usageError("sandbox <catalog|plan|checkout|status|debugger|receipts>");
  }
}

function launchCodex(args: string[]): number {
  const executable = process.argv[1];
  const codexArgs = ["-c", `mcp_servers.gcp_x402.command=${JSON.stringify(process.execPath)}`, "-c", `mcp_servers.gcp_x402.args=${JSON.stringify([executable])}`, "-c", "mcp_servers.gcp_x402.enabled_tools=[\"sandbox_setup\",\"sandbox_catalog\",\"sandbox_plan\",\"sandbox_checkout\",\"sandbox_status\"]", ...args];
  const result = spawnSync("codex", codexArgs, { stdio: "inherit", env: { ...process.env, GCP_X402_SANDBOX: "true" } });
  if (result.error) throw new Error(`Could not launch Codex: ${result.error.message}`);
  return result.status ?? 1;
}

async function readHiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    console.error("Run `gcp-x402 unlock` in an interactive terminal so the password is not exposed in command history.");
    return "";
  }
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const wasRaw = input.isRaw;
    let password = "";
    const finish = (error?: Error) => {
      input.off("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      process.stderr.write("\n");
      if (error) reject(error); else resolve(password);
    };
    const onData = (chunk: Buffer | string) => {
      for (const char of String(chunk)) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new Error("Unlock cancelled."));
        if (char === "\u007f" || char === "\b") password = password.slice(0, -1);
        else if (password.length < 256) password += char;
      }
    };
    process.stderr.write("Private beta password: ");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function usageError(usage: string): number {
  console.error(`usage: ${usage}`);
  return 2;
}
