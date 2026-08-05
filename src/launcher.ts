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
    "-c", `mcp_servers.gcp_x402.command=${JSON.stringify(process.execPath)}`,
    "-c", `mcp_servers.gcp_x402.args=${JSON.stringify([executable])}`,
    "-c", `mcp_servers.gcp_x402.enabled_tools=${JSON.stringify(NATIVE_MCP_TOOLS)}`,
  ];
  // Codex may launch stdio MCP children with a narrowed environment. Pin the
  // selected hosted service in the MCP configuration rather than relying on
  // the shell's PROXY_URL inheritance.
  if (proxyUrl) config.push("-c", `mcp_servers.gcp_x402.env.PROXY_URL=${JSON.stringify(proxyUrl)}`);
  return [...config, ...args];
}
