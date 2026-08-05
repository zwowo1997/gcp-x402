import { spawnSync } from "node:child_process";

export interface MoonPayTopupView {
  walletAddress: string;
  fiatAmountUsd: number;
  asset: string;
  network: string;
  checkoutUrl: string;
}

export function validateMoonPaySandboxUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "buy-sandbox.moonpay.com") {
    throw new Error("MoonPay showcase only opens the official sandbox host.");
  }
  return url;
}

export function renderMoonPayTopup(view: MoonPayTopupView): string {
  const wallet = `${view.walletAddress.slice(0, 8)}…${view.walletAddress.slice(-6)}`;
  return [
    "┌────────────────────────────────────────────────────────────┐",
    "│ gcp-x402 top up                                           │",
    "├────────────────────────────────────────────────────────────┤",
    "│ Provider       MoonPay hosted sandbox                     │",
    `│ Destination    ${wallet.padEnd(42)}│`,
    `│ Purchase       $${view.fiatAmountUsd.toFixed(2)} ${view.asset}`.padEnd(61) + "│",
    `│ Network        ${view.network}`.padEnd(61) + "│",
    "│ Payment UI     MoonPay (card / Apple Pay when available)  │",
    "├────────────────────────────────────────────────────────────┤",
    "│ SHOWCASE ONLY                                              │",
    "│ The demo ends when MoonPay opens. No GCP resource, x402    │",
    "│ settlement, or trading action follows this checkout.       │",
    "└────────────────────────────────────────────────────────────┘",
  ].join("\n");
}

export function openExternalUrl(value: string): void {
  const url = validateMoonPaySandboxUrl(value).toString();
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.error || result.status !== 0) throw new Error(`Could not open MoonPay sandbox. Open this URL manually: ${url}`);
}
