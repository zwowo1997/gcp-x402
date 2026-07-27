import { Firestore } from "@google-cloud/firestore";
import { type TradingEvent, type TradingStackRecord } from "./types";

const memoryStacks = new Map<string, TradingStackRecord>();
const memoryEvents = new Map<string, TradingEvent[]>();
let firestore: Firestore | null | undefined;

function db(): Firestore | null {
  if (firestore !== undefined) return firestore;
  try { firestore = process.env.GCP_PROJECT_ID ? new Firestore({ projectId: process.env.GCP_PROJECT_ID }) : null; }
  catch { firestore = null; }
  return firestore;
}

export async function saveTradingStack(stack: TradingStackRecord): Promise<void> {
  memoryStacks.set(stack.id, stack);
  await db()?.collection("trading_stacks").doc(stack.id).set(stack);
}

export async function reserveTradingStack(stack: TradingStackRecord, maxExposureUsd: number): Promise<void> {
  const firestoreDb = db();
  if (!firestoreDb) {
    const outstanding = [...memoryStacks.values()]
      .filter((item) => !["shutdown", "expired", "failed"].includes(item.status))
      .reduce((total, item) => total + item.maxGcpCostUsd, 0);
    if (outstanding + stack.maxGcpCostUsd > maxExposureUsd) throw new Error("Testing spend exposure is exhausted; stop or shut down an existing trading stack first.");
    memoryStacks.set(stack.id, stack);
    return;
  }
  await firestoreDb.runTransaction(async (tx) => {
    const [regularJobs, tradingStacks] = await Promise.all([
      tx.get(firestoreDb.collection("provisioning_jobs")),
      tx.get(firestoreDb.collection("trading_stacks")),
    ]);
    const regularExposure = regularJobs.docs.map((doc) => doc.data() as { status: string; maxGcpCostUsd: number })
      .filter((item) => !["closed", "failed"].includes(item.status)).reduce((total, item) => total + item.maxGcpCostUsd, 0);
    const tradingExposure = tradingStacks.docs.map((doc) => doc.data() as TradingStackRecord)
      .filter((item) => !["shutdown", "expired", "failed"].includes(item.status)).reduce((total, item) => total + item.maxGcpCostUsd, 0);
    if (regularExposure + tradingExposure + stack.maxGcpCostUsd > maxExposureUsd) throw new Error("Testing spend exposure is exhausted; stop or shut down an existing resource first.");
    tx.create(firestoreDb.collection("trading_stacks").doc(stack.id), stack);
  });
  memoryStacks.set(stack.id, stack);
}

export async function getTradingStack(id: string): Promise<TradingStackRecord | null> {
  const snap = await db()?.collection("trading_stacks").doc(id).get();
  return snap?.exists ? (snap.data() as TradingStackRecord) : memoryStacks.get(id) ?? null;
}

export async function listTradingStacks(): Promise<TradingStackRecord[]> {
  const snap = await db()?.collection("trading_stacks").orderBy("createdAt", "desc").get();
  return snap ? snap.docs.map((doc) => doc.data() as TradingStackRecord) : [...memoryStacks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addTradingEvent(event: TradingEvent): Promise<void> {
  memoryEvents.set(event.stackId, [...(memoryEvents.get(event.stackId) ?? []), event].slice(-100));
  await db()?.collection("trading_stacks").doc(event.stackId).collection("events").doc(event.id).set(event);
}

export async function listTradingEvents(stackId: string): Promise<TradingEvent[]> {
  const snap = await db()?.collection("trading_stacks").doc(stackId).collection("events").orderBy("createdAt", "desc").limit(100).get();
  return snap ? snap.docs.map((doc) => doc.data() as TradingEvent) : [...(memoryEvents.get(stackId) ?? [])].reverse();
}
