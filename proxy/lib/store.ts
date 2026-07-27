import { Firestore, FieldValue } from "@google-cloud/firestore";

export type JobStatus = "payment_pending" | "provisioning" | "active" | "stopping" | "closed" | "failed";
export type TransactionStatus = "pending" | "verified" | "settled" | "refunded" | "failed";

export interface JobRecord {
  id: string;
  payer: string;
  resourceId: string;
  status: JobStatus;
  maxGcpCostUsd: number;
  settledAmountUsd: number;
  createdAt: string;
  expiresAt: string;
  gcpResourceId?: string;
  error?: string;
}

export interface TransactionRecord {
  id: string;
  payer: string;
  service: "bigquery" | "compute" | "storage" | "trading";
  operation: string;
  status: TransactionStatus;
  requestedAmountUsd: number;
  settledAmountUsd?: number;
  refundedAmountUsd?: number;
  resourceId?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

const memoryJobs = new Map<string, JobRecord>();
const memoryTransactions = new Map<string, TransactionRecord>();
let firestore: Firestore | null | undefined;

function db(): Firestore | null {
  if (firestore !== undefined) return firestore;
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.GCP_PROJECT_ID) {
    try { firestore = new Firestore({ projectId: process.env.GCP_PROJECT_ID }); }
    catch { firestore = null; }
  } else firestore = null;
  return firestore;
}

export async function saveJob(job: JobRecord): Promise<void> {
  memoryJobs.set(job.id, job);
  await db()?.collection("provisioning_jobs").doc(job.id).set(job);
}

/** Atomically reserve maximum GCP exposure before any payment or resource API call. */
export async function reserveJob(job: JobRecord, maxExposureUsd: number): Promise<void> {
  const firestoreDb = db();
  if (!firestoreDb) {
    const outstanding = [...memoryJobs.values()]
      .filter((j) => !["closed", "failed"].includes(j.status))
      .reduce((sum, j) => sum + j.maxGcpCostUsd, 0);
    if (outstanding + job.maxGcpCostUsd > maxExposureUsd) throw new Error("Testing spend exposure is exhausted; clean up an active resource first.");
    memoryJobs.set(job.id, job);
    return;
  }
  await firestoreDb.runTransaction(async (tx) => {
    const jobs = await tx.get(firestoreDb.collection("provisioning_jobs"));
    const outstanding = jobs.docs
      .map((doc) => doc.data() as JobRecord)
      .filter((j) => !["closed", "failed"].includes(j.status))
      .reduce((sum, j) => sum + j.maxGcpCostUsd, 0);
    if (outstanding + job.maxGcpCostUsd > maxExposureUsd) throw new Error("Testing spend exposure is exhausted; clean up an active resource first.");
    tx.create(firestoreDb.collection("provisioning_jobs").doc(job.id), job);
  });
  memoryJobs.set(job.id, job);
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const snap = await db()?.collection("provisioning_jobs").doc(id).get();
  return snap?.exists ? (snap.data() as JobRecord) : memoryJobs.get(id) ?? null;
}

export async function listJobs(): Promise<JobRecord[]> {
  const snap = await db()?.collection("provisioning_jobs").orderBy("createdAt", "desc").get();
  return snap ? snap.docs.map((d) => d.data() as JobRecord) : [...memoryJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveTransaction(tx: TransactionRecord): Promise<void> {
  memoryTransactions.set(tx.id, tx);
  await db()?.collection("transactions").doc(tx.id).set(tx);
}

export async function listTransactions(): Promise<TransactionRecord[]> {
  const snap = await db()?.collection("transactions").orderBy("createdAt", "desc").get();
  return snap ? snap.docs.map((d) => d.data() as TransactionRecord) : [...memoryTransactions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function outstandingExposureUsd(): Promise<number> {
  const jobs = await listJobs();
  return jobs.filter((j) => !["closed", "failed"].includes(j.status)).reduce((sum, j) => sum + j.maxGcpCostUsd, 0);
}

/** Dashboard/telemetry writes must never turn a completed paid request into an error. */
export async function recordTransaction(tx: TransactionRecord): Promise<void> {
  try {
    await saveTransaction(tx);
    await incrementUser(tx.payer);
  } catch (error) {
    console.error("Non-critical transaction telemetry failed:", error);
  }
}

export async function incrementUser(wallet: string): Promise<void> {
  const firestoreDb = db();
  if (firestoreDb) {
    await firestoreDb.collection("users").doc(wallet.toLowerCase()).set({ wallet, lastSeenAt: new Date().toISOString(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}
