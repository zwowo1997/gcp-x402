import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { config } from "./config.js";
import { paymentProviderInfo, type PaymentProviderInfo } from "./payment-provider.js";
import { v3Quote, v3ResourceBreakdown, type V3DurationMinutes, type V3ProductId } from "./v3-contracts.js";

export interface SandboxAccount { address: string; privateKey: Hex; createdAt: string; network: "base-sepolia"; virtualUsdcBalance: number; mode: "sandbox"; }
export interface SandboxPlan { planId: string; createdAt: string; intent: string; productId: V3ProductId; durationMinutes: V3DurationMinutes; walletAddress: string; quote: ReturnType<typeof v3Quote>; resources: ReturnType<typeof v3ResourceBreakdown>; provider: PaymentProviderInfo; }
export interface SandboxReceipt { checkoutId: string; planId: string; stackId: string; createdAt: string; dashboardUrl?: string; status?: string; paymentStatus?: string; trace: Array<{ at: string; event: string; detail: string }>; }

function ensureDirectory() {
  const directory = dirname(config.sandboxFile);
  mkdirSync(directory, { recursive: true });
  try { writeFileSync(join(directory, ".gitignore"), "*\n", { flag: "wx" }); } catch { /* already ignored */ }
}
function readJson<T>(path: string, fallback: T): T { try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as T : fallback; } catch { return fallback; } }
function writeJson(path: string, value: unknown) { ensureDirectory(); writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 }); try { chmodSync(path, 0o600); } catch { /* best effort */ } }

export function sandboxAccount(): SandboxAccount {
  const current = readJson<SandboxAccount | null>(config.sandboxFile, null);
  if (current?.address && current.privateKey) return current;
  const privateKey = generatePrivateKey();
  const account: SandboxAccount = { address: privateKeyToAccount(privateKey).address, privateKey, createdAt: new Date().toISOString(), network: "base-sepolia", virtualUsdcBalance: 20, mode: "sandbox" };
  writeJson(config.sandboxFile, account);
  return account;
}

function resolveIntent(intent: string): { productId: V3ProductId; durationMinutes: V3DurationMinutes } {
  const text = intent.toLowerCase();
  const productId: V3ProductId = /storage|bucket/.test(text) ? "storage.small" : /\bvm\b|compute|virtual machine/.test(text) ? "vm.small" : "trading.paper.ema";
  const durationMinutes: V3DurationMinutes = /\b60\b|one hour|1 hour/.test(text) ? 60 : /\b30\b/.test(text) ? 30 : 15;
  return { productId, durationMinutes };
}

export function createSandboxPlan(intent: string): SandboxPlan {
  if (!intent.trim()) throw new Error("Describe the infrastructure you want to plan.");
  const { productId, durationMinutes } = resolveIntent(intent);
  const account = sandboxAccount();
  const quote = v3Quote(productId, durationMinutes);
  const plan: SandboxPlan = { planId: `plan-${randomUUID()}`, createdAt: new Date().toISOString(), intent: intent.trim(), productId, durationMinutes, walletAddress: account.address, quote, resources: v3ResourceBreakdown(quote), provider: paymentProviderInfo(config.paymentProvider) };
  const plans = readJson<SandboxPlan[]>(config.sandboxPlansFile, []);
  plans.push(plan); writeJson(config.sandboxPlansFile, plans);
  return plan;
}

export function getSandboxPlan(planId: string): SandboxPlan | null { return readJson<SandboxPlan[]>(config.sandboxPlansFile, []).find((plan) => plan.planId === planId) ?? null; }
export function listSandboxReceipts(): SandboxReceipt[] { return readJson<SandboxReceipt[]>(config.sandboxReceiptsFile, []); }
export function saveSandboxReceipt(receipt: SandboxReceipt): SandboxReceipt { const all = listSandboxReceipts(); all.push(receipt); writeJson(config.sandboxReceiptsFile, all); return receipt; }
export function updateSandboxReceipt(checkoutId: string, update: Partial<Pick<SandboxReceipt, "status" | "paymentStatus" | "dashboardUrl">> & { event?: string; detail?: string }): SandboxReceipt | null {
  const all = listSandboxReceipts(); const receipt = all.find((item) => item.checkoutId === checkoutId); if (!receipt) return null;
  Object.assign(receipt, update); if (update.event) receipt.trace.push({ at: new Date().toISOString(), event: update.event, detail: update.detail ?? "" });
  writeJson(config.sandboxReceiptsFile, all); return receipt;
}
export function getSandboxReceipt(id: string): SandboxReceipt | null { return listSandboxReceipts().find((item) => item.checkoutId === id || item.stackId === id) ?? null; }
