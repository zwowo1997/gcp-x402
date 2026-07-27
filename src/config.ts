import { join, isAbsolute } from "node:path";

/**
 * Resolve the keystore path. Defaults to a PER-PROJECT location:
 * `.gcp-x402/wallet.json` under the directory the MCP server is launched in (the
 * project root, for Claude Code), so each project gets its own wallet. A
 * WALLET_FILE override may be absolute (e.g. a shared per-machine wallet) or
 * relative (resolved against the working directory).
 */
function resolveWalletFile(): string {
  const override = process.env.WALLET_FILE;
  if (override) return isAbsolute(override) ? override : join(process.cwd(), override);
  return join(process.cwd(), ".gcp-x402", "wallet.json");
}

export const config = {
  /** Base URL of the gcp-x402 proxy. Defaults to the hosted deployment. */
  proxyUrl: (process.env.PROXY_URL ?? "https://gcp-x402-837831206506.us-central1.run.app").replace(/\/$/, ""),

  /**
   * Optional explicit key (power users / CI). When unset, the server generates
   * and persists a wallet on first run — see wallet.ts.
   */
  privateKeyEnv: process.env.WALLET_PRIVATE_KEY,

  /** Where the auto-generated wallet is stored (per-project by default). */
  walletFile: resolveWalletFile(),

  /** Hard ceiling on what a single query may auto-pay, in USD. */
  maxPaymentUsd: Number(process.env.MAX_PAYMENT_USD ?? "1.00"),
} as const;
