import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const NATIVE_MCP_TOOLS = [
  "unlock_service",
  "wallet_info",
  "v3_trading_catalog",
  "v3_trading_quote",
  "v3_trading_deploy",
  "v3_trading_status",
  "v3_trading_control",
  "v3_trading_receipts",
  "moonpay_showcase",
  "trading_status",
  "trading_control",
  "sandbox_setup",
  "sandbox_plan",
  "sandbox_checkout",
  "sandbox_status",
] as const;

// Keep the V3 journey deterministic even when an older, globally installed
// gcp-x402 skill is still discoverable by Codex. Tool allowlisting prevents a
// legacy MCP call, while these session instructions prevent shell-command
// fallback and require payment-route selection before any wallet or quote call.
export const NATIVE_SESSION_INSTRUCTIONS = `This is a gcp-x402 V3 native MCP session. For every Hyperliquid or paper-trading deployment request, use only the gcp_x402 MCP tools and never run legacy gcp-x402 trading shell commands. Before calling wallet_info, v3_trading_catalog, or v3_trading_quote, ask which payment path the user wants unless their request already selects one: (1) Base Sepolia testnet USDC for an end-to-end temporary deployment, or (2) MoonPay sandbox for a hosted card/Apple Pay showcase that stops before payment and deployment. Use moonpay_showcase only after MoonPay is selected. Use v3_trading_quote only after testnet USDC is selected. A clear affirmative to the one immediately preceding fresh quote is sufficient approval; never require the user to repeat quote details.`;

export function isNestedCodexSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CODEX_THREAD_ID) && env.GCP_X402_ALLOW_NESTED_CODEX !== "1";
}

export const NESTED_CODEX_START_ERROR = `gcp-x402 cannot attach MCP tools to the Codex chat that launched this command. Starting Codex here would create a hidden child session while the current chat remains unchanged.

Terminal users: run the gcp-x402 start command yourself in an outer terminal, then interact with the Codex session it opens.
Codex Desktop users: open Settings > MCP servers, add gcp_x402 as an STDIO server, save, and restart Codex Desktop.

Do not report that the current chat was upgraded or that a background launcher succeeded.`;

export function nativeStateDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.GCP_X402_HOME || join(homedir(), ".gcp-x402"));
}

export function ensureNativeStateDirectory(directory = nativeStateDirectory()): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { writeFileSync(join(directory, ".gitignore"), "*\n", { flag: "wx", mode: 0o600 }); } catch { /* already initialized */ }
  return directory;
}

export function nativeSessionEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const directory = nativeStateDirectory(env);
  return {
    ...env,
    GCP_X402_HOME: directory,
    WALLET_FILE: join(directory, "wallet.json"),
    GCP_X402_BETA_SESSION_FILE: join(directory, "beta-session.json"),
    GCP_X402_SANDBOX: "true",
  };
}

export function codexLaunchArguments(executable: string, args: string[], proxyUrl?: string): string[] {
  const config = [
    "-c", `developer_instructions=${JSON.stringify(NATIVE_SESSION_INSTRUCTIONS)}`,
    "-c", `mcp_servers.gcp_x402.command=${JSON.stringify(process.execPath)}`,
    "-c", `mcp_servers.gcp_x402.args=${JSON.stringify([executable])}`,
    "-c", `mcp_servers.gcp_x402.enabled_tools=${JSON.stringify(NATIVE_MCP_TOOLS)}`,
    "-c", "mcp_servers.gcp_x402.tool_timeout_sec=180",
  ];
  // Codex may launch stdio MCP children with a narrowed environment. Pin the
  // selected hosted service in the MCP configuration rather than relying on
  // the shell's PROXY_URL inheritance.
  if (proxyUrl) config.push("-c", `mcp_servers.gcp_x402.env.PROXY_URL=${JSON.stringify(proxyUrl)}`);
  return [...config, ...args];
}
