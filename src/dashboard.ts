import { spawnSync } from "node:child_process";
import { getTradingReceipt } from "./trading-receipt.js";
import { betaSessionToken } from "./beta-session.js";

export function openTradingDashboard(stackId: string): { stackId: string; dashboard: string; expiresAt: string } {
  const receipt = getTradingReceipt(stackId);
  if (!receipt?.dashboardUrl || !receipt.capability) throw new Error("No private dashboard receipt is available for this stack on this machine.");
  if (new Date(receipt.expiresAt).getTime() <= Date.now()) throw new Error("This paper-stack lease has expired; its dashboard credentials are no longer usable.");
  const url = new URL(receipt.dashboardUrl);
  const session = betaSessionToken();
  const hash = new URLSearchParams(url.hash.slice(1));
  if (!session) throw new Error("The local beta session is expired. Unlock the MCP once, then reopen this dashboard; do not redeploy.");
  if (url.protocol !== "https:" || !hash.get("capability")) throw new Error("The local dashboard receipt is incomplete. Do not redeploy; recover the original deployment response instead.");
  hash.set("session", session);
  url.hash = hash.toString();
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url.toString()] : [url.toString()];
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.error || result.status !== 0) throw new Error("The local process could not open the dashboard browser window.");
  return { stackId, dashboard: url.origin + url.pathname, expiresAt: receipt.expiresAt };
}
