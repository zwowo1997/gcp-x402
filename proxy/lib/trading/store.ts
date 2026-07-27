import { Firestore } from "@google-cloud/firestore";
import { createHash } from "node:crypto";
import { type TradingEvent, type TradingStackRecord } from "./types";

const memoryStacks = new Map<string, TradingStackRecord>();
const memoryEvents = new Map<string, TradingEvent[]>();
const memoryRequestKeys = new Map<string, string>();
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

export interface TradingReservation { created: boolean; stack: TradingStackRecord }

export async function reserveTradingStack(stack: TradingStackRecord, maxExposureUsd: number): Promise<TradingReservation> {
  if (!stack.requestKey) throw new Error("A deployment request key is required.");
  const firestoreDb = db();
  if (!firestoreDb) {
    const existingId = memoryRequestKeys.get(stack.requestKey);
    const existing = existingId ? memoryStacks.get(existingId) : undefined;
    if (existing) return { created: false, stack: existing };
    const outstanding = [...memoryStacks.values()]
      .filter((item) => !["shutdown", "expired", "failed"].includes(item.status))
      .reduce((total, item) => total + item.maxGcpCostUsd, 0);
    if (outstanding + stack.maxGcpCostUsd > maxExposureUsd) throw new Error("Testing spend exposure is exhausted; stop or shut down an existing trading stack first.");
    memoryStacks.set(stack.id, stack);
    memoryRequestKeys.set(stack.requestKey, stack.id);
    return { created: true, stack };
  }
  const requestKeyId = createHash("sha256").update(stack.requestKey).digest("hex");
  const reservation = await firestoreDb.runTransaction(async (tx): Promise<TradingReservation> => {
    const requestRef = firestoreDb.collection("trading_request_keys").doc(requestKeyId);
    const requestSnap = await tx.get(requestRef);
    if (requestSnap.exists) {
      const existingId = requestSnap.data()?.stackId as string | undefined;
      if (!existingId) throw new Error("Deployment request reservation is corrupt.");
      const existingSnap = await tx.get(firestoreDb.collection("trading_stacks").doc(existingId));
      if (!existingSnap.exists) throw new Error("Deployment request reservation has no stack record.");
      return { created: false, stack: existingSnap.data() as TradingStackRecord };
    }
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
    tx.create(requestRef, { stackId: stack.id, requestKey: stack.requestKey, createdAt: stack.createdAt });
    return { created: true, stack };
  });
  memoryStacks.set(reservation.stack.id, reservation.stack);
  memoryRequestKeys.set(stack.requestKey, reservation.stack.id);
  return reservation;
}

export async function getTradingStack(id: string): Promise<TradingStackRecord | null> {
  const snap = await db()?.collection("trading_stacks").doc(id).get();
  return snap?.exists ? (snap.data() as TradingStackRecord) : memoryStacks.get(id) ?? null;
}

export async function listTradingStacks(): Promise<TradingStackRecord[]> {
  const snap = await db()?.collection("trading_stacks").orderBy("createdAt", "desc").get();
  return snap ? snap.docs.map((doc) => doc.data() as TradingStackRecord) : [...memoryStacks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findTradingStackByRequestKey(requestKey: string): Promise<TradingStackRecord | null> {
  const firestoreDb = db();
  if (firestoreDb) {
    const snap = await firestoreDb.collection("trading_stacks").where("requestKey", "==", requestKey).limit(1).get();
    return snap.empty ? null : snap.docs[0].data() as TradingStackRecord;
  }
  return [...memoryStacks.values()].find((stack) => stack.requestKey === requestKey) ?? null;
}

export async function addTradingEvent(event: TradingEvent): Promise<void> {
  memoryEvents.set(event.stackId, [...(memoryEvents.get(event.stackId) ?? []), event].slice(-100));
  await db()?.collection("trading_stacks").doc(event.stackId).collection("events").doc(event.id).set(event);
}

export async function listTradingEvents(stackId: string): Promise<TradingEvent[]> {
  const snap = await db()?.collection("trading_stacks").doc(stackId).collection("events").orderBy("createdAt", "desc").limit(100).get();
  return snap ? snap.docs.map((doc) => doc.data() as TradingEvent) : [...(memoryEvents.get(stackId) ?? [])].reverse();
}
