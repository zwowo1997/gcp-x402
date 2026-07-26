// CLI mode for the gcp-x402 binary.
//
// The same package is both an MCP server (no args) and a plain CLI (with args),
// so a skill can drive it over Bash via `npx -y <repo> <command>` without any
// MCP registration. Output is written for an agent to read: a human-readable
// summary on stderr, the actual data (rows / json) on stdout.

import { estimate, query, listDatasets, walletInfo, provisionCatalog, provisionResource, provisionStatus, provisionDelete } from "./client.js";

const USAGE = `gcp-x402 — query BigQuery public datasets, paid per query in USDC (x402)

Usage:
  npx -y github:nalin/gcp-x402 <command>

Commands:
  wallet                 Show this project's wallet address, USDC balance, and how to fund it.
  estimate "<sql>"       Dry-run a query: exact price + bytes, without paying or running it.
  query "<sql>"          Run a read-only query, auto-pay the USDC price, print the rows.
  datasets               List popular public datasets and current pricing.
  catalog                List provisionable GCP resource profiles.
  provision <resource>  Provision vm.small or storage.small and pay via x402.
  provision-status <id> <capability> Show a provisioning job.
  provision-delete <id> <capability> Delete a provisioned resource.
  help                   Show this message.

Only bigquery-public-data tables are queryable; read-only (no DML/DDL).`;

export async function runCli(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const sql = argv.slice(1).join(" ").trim();

  switch (cmd) {
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

function usageError(usage: string): number {
  console.error(`usage: ${usage}`);
  return 2;
}
