import { google } from "googleapis";
import { Storage } from "@google-cloud/storage";
import { config } from "./config";
import { type CatalogItem } from "./catalog";

const zone = process.env.GCP_ZONE ?? "us-central1-a";
const network = process.env.GCP_NETWORK ?? "default";
const projectId = () => config.gcpProjectId;

async function waitForZoneOperation(operationName: string): Promise<void> {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const compute = google.compute({ version: "v1", auth });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = await compute.zoneOperations.get({ project: projectId(), zone, operation: operationName });
    if (result.data.status === "DONE") {
      if (result.data.error) throw new Error(`Compute Engine operation failed: ${JSON.stringify(result.data.error.errors ?? result.data.error)}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for Compute Engine operation.");
}

export async function createResource(item: CatalogItem, jobId: string): Promise<string> {
  const labels = { managed_by: "gcp_x402", job_id: jobId };
  if (item.kind === "storage") {
    const storage = new Storage({ projectId: projectId() });
    const bucketName = `${projectId()}-gcp-x402-${jobId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63);
    let bucket;
    try {
      [bucket] = await storage.createBucket(bucketName, { location: item.region, labels, iamConfiguration: { uniformBucketLevelAccess: { enabled: true } } });
      await bucket.setMetadata({ iamConfiguration: { uniformBucketLevelAccess: { enabled: true } }, labels });
      return bucket.name;
    } catch (error) {
      if (bucket) await bucket.delete().catch(() => undefined);
      throw error;
    }
  }

  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const compute = google.compute({ version: "v1", auth });
  const name = `gcp-x402-${jobId}`.toLowerCase();
  const operation = await compute.instances.insert({ project: projectId(), zone, requestBody: {
    name,
    machineType: `zones/${zone}/machineTypes/${process.env.GCP_VM_MACHINE_TYPE ?? "e2-micro"}`,
    labels,
    disks: [{ boot: true, autoDelete: true, initializeParams: { sourceImage: process.env.GCP_VM_IMAGE ?? "projects/debian-cloud/global/images/family/debian-12" } }],
    networkInterfaces: [{ network: `projects/${projectId()}/global/networks/${network}` }],
  } });
  if (!operation.data.name) throw new Error("Compute Engine did not return an operation.");
  try {
    await waitForZoneOperation(operation.data.name);
    const created = await compute.instances.get({ project: projectId(), zone, instance: name });
    if (created.data.status !== "RUNNING") throw new Error(`VM did not reach RUNNING state (got ${created.data.status ?? "unknown"}).`);
    return name;
  } catch (error) {
    const cleanup = await compute.instances.delete({ project: projectId(), zone, instance: name }).catch(() => undefined);
    if (cleanup?.data.name) await waitForZoneOperation(cleanup.data.name).catch(() => undefined);
    throw error;
  }
}

export async function deleteResource(item: CatalogItem, resourceId: string): Promise<void> {
  if (item.kind === "storage") {
    const bucket = new Storage({ projectId: projectId() }).bucket(resourceId);
    const [metadata] = await bucket.getMetadata();
    if (metadata.labels?.managed_by !== "gcp_x402") throw new Error("Refusing to delete an unmanaged bucket.");
    const [files] = await bucket.getFiles();
    await Promise.all(files.map((file) => file.delete()));
    await bucket.delete();
    return;
  }
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const compute = google.compute({ version: "v1", auth });
  const instance = await compute.instances.get({ project: projectId(), zone, instance: resourceId });
  if (instance.data.labels?.managed_by !== "gcp_x402") throw new Error("Refusing to delete an unmanaged VM.");
  const operation = await compute.instances.delete({ project: projectId(), zone, instance: resourceId });
  if (!operation.data.name) throw new Error("Compute Engine did not return a delete operation.");
  await waitForZoneOperation(operation.data.name);
}
