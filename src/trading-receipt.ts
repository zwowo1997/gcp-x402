import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

export interface TradingReceipt {
  stackId: string;
  mode: "paper";
  region: string;
  expiresAt: string;
  maxPriceUsd: number;
  capability: string;
  dashboardUrl?: string;
  paperOnly: true;
  resources?: Record<string, string>;
  savedAt: string;
}

interface PendingTradingDeployment {
  requestId: string;
  configJson: string;
  createdAt: string;
}

function ensurePrivateDirectory(file: string): void {
  const directory = dirname(file);
  mkdirSync(directory, { recursive: true });
  try { writeFileSync(`${directory}/.gitignore`, "*\n", { flag: "wx" }); } catch { /* already exists */ }
}

function readReceipts(): TradingReceipt[] {
  try { return existsSync(config.tradingReceiptsFile) ? JSON.parse(readFileSync(config.tradingReceiptsFile, "utf8")) as TradingReceipt[] : []; }
  catch { return []; }
}

export function saveTradingReceipt(receipt: TradingReceipt): void {
  ensurePrivateDirectory(config.tradingReceiptsFile);
  const receipts = [receipt, ...readReceipts().filter((item) => item.stackId !== receipt.stackId)].slice(0, 20);
  writeFileSync(config.tradingReceiptsFile, JSON.stringify(receipts, null, 2), { mode: 0o600 });
  try { chmodSync(config.tradingReceiptsFile, 0o600); } catch { /* best effort on non-POSIX systems */ }
}

export function getTradingReceipt(stackId: string): TradingReceipt | null {
  return readReceipts().find((item) => item.stackId === stackId) ?? null;
}

export function listTradingReceipts(): TradingReceipt[] {
  return readReceipts();
}

function readPending(file: string): PendingTradingDeployment[] {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as PendingTradingDeployment[] : []; }
  catch { return []; }
}

function writePending(file: string, pending: PendingTradingDeployment[]): void {
  ensurePrivateDirectory(file);
  writeFileSync(file, JSON.stringify(pending, null, 2), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort on non-POSIX systems */ }
}

/** Reuse one request ID for the same deployment input until its outcome is known. */
export function pendingTradingRequestId(configInput: unknown, createId: () => string, file = config.tradingPendingFile): string {
  const configJson = JSON.stringify(configInput);
  const pending = readPending(file);
  const existing = pending.find((item) => item.configJson === configJson);
  if (existing) return existing.requestId;
  const next = { requestId: createId(), configJson, createdAt: new Date().toISOString() };
  writePending(file, [next, ...pending].slice(0, 20));
  return next.requestId;
}

export function clearPendingTradingRequest(requestId: string, file = config.tradingPendingFile): void {
  const pending = readPending(file).filter((item) => item.requestId !== requestId);
  writePending(file, pending);
}
