import { getCatalogItem } from "./catalog";
import { deleteResource } from "./provisioning";
import { getJob, recordTransaction, saveJob, type JobRecord } from "./store";

export async function closeJob(job: JobRecord, operation: "delete" | "expiry"): Promise<void> {
  if (!["closed", "failed"].includes(job.status) && job.gcpResourceId) {
    const item = getCatalogItem(job.resourceId);
    if (!item) throw new Error(`Unknown catalog resource ${job.resourceId}`);
    await deleteResource(item, job.gcpResourceId);
  }
  await saveJob({ ...job, status: "closed" });
  await recordTransaction({
    id: `${operation}-${job.id}`,
    payer: job.payer,
    service: job.resourceId.startsWith("vm.") ? "compute" : "storage",
    operation,
    status: "settled",
    requestedAmountUsd: 0,
    settledAmountUsd: 0,
    resourceId: job.id,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
}

export async function closeJobById(jobId: string, operation: "delete" | "expiry"): Promise<boolean> {
  const job = await getJob(jobId);
  if (!job) return false;
  await closeJob(job, operation);
  return true;
}
