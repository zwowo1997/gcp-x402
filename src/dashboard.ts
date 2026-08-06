import { spawnSync } from "node:child_process";
import { getTradingReceipt } from "./trading-receipt.js";

export function openTradingDashboard(stackId: string): { stackId: string; dashboard: string; expiresAt: string } {
  const receipt = getTradingReceipt(stackId);
  if (!receipt?.dashboardUrl || !receipt.capability) throw new Error("No private dashboard receipt is available for this stack on this machine.");
  if (new Date(receipt.expiresAt).getTime() <= Date.now()) throw new Error("This paper-stack lease has expired; its dashboard credentials are no longer usable.");
  const url = new URL(receipt.dashboardUrl);
  if (url.protocol !== "https:" || !url.hash.includes("capability=") || !url.hash.includes("session=")) throw new Error("The local dashboard receipt is incomplete. Do not redeploy; recover the original deployment response instead.");
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url.toString()] : [url.toString()];
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.error || result.status !== 0) throw new Error("The local process could not open the dashboard browser window.");
  return { stackId, dashboard: url.origin + url.pathname, expiresAt: receipt.expiresAt };
}
