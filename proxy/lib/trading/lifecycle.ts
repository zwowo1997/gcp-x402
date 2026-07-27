import { randomUUID } from "node:crypto";
import { deleteTradingStackResources, resumeTradingStackResources, stopTradingStackResources } from "./provisioning";
import { addTradingEvent, getTradingStack, saveTradingStack } from "./store";
import { type TradingControl, type TradingStackRecord } from "./types";

async function event(stack: TradingStackRecord, type: "started" | "stopped" | "resumed" | "shutdown" | "expired" | "failed", message: string) {
  await addTradingEvent({ id: randomUUID(), stackId: stack.id, type, message, createdAt: new Date().toISOString() });
}

export async function controlTradingStack(stack: TradingStackRecord, control: TradingControl): Promise<TradingStackRecord> {
  if (control === "shutdown") {
    await deleteTradingStackResources(stack.resources);
    const next = { ...stack, status: "shutdown" as const, updatedAt: new Date().toISOString() };
    await saveTradingStack(next); await event(next, "shutdown", "Paper trading stack permanently shut down.");
    return next;
  }
  if (control === "stop") {
    if (stack.status !== "running") return stack;
    await stopTradingStackResources(stack.resources);
    const next = { ...stack, status: "stopped" as const, updatedAt: new Date().toISOString() };
    await saveTradingStack(next); await event(next, "stopped", "Paper strategy subscriptions stopped; no new simulated orders will be created.");
    return next;
  }
  if (control === "resume" || control === "start") {
    if (new Date(stack.expiresAt).getTime() <= Date.now()) throw new Error("This paper trading lease has expired and cannot be resumed.");
    if (stack.status === "running") return stack;
    await resumeTradingStackResources(stack.resources);
    const next = { ...stack, status: "running" as const, updatedAt: new Date().toISOString() };
    await saveTradingStack(next); await event(next, "resumed", "Paper strategy resumed using real market data and simulated execution.");
    return next;
  }
  return stack;
}

export async function expireTradingStack(stackId: string): Promise<boolean> {
  const stack = await getTradingStack(stackId);
  if (!stack || ["shutdown", "expired"].includes(stack.status)) return false;
  await deleteTradingStackResources(stack.resources);
  const next = { ...stack, status: "expired" as const, updatedAt: new Date().toISOString() };
  await saveTradingStack(next); await event(next, "expired", "24-hour paper trading lease expired and its GCP runtime resources were deleted.");
  return true;
}
