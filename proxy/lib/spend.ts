import { config } from "./config";
import { getCatalogItem, type CatalogItem } from "./catalog";

export function assertWithinSpendCap(item: CatalogItem, outstandingUsd: number): void {
  if (item.maxGcpCostUsd > config.maxGcpCostPerProvisionUsd) {
    throw new Error(`Resource ${item.id} exceeds the $${config.maxGcpCostPerProvisionUsd} testing cap.`);
  }
  if (outstandingUsd + item.maxGcpCostUsd > config.maxOutstandingGcpExposureUsd) {
    throw new Error("Testing spend exposure is exhausted; clean up an active resource first.");
  }
}

export function validateProvisionRequest(resourceId: string, durationMinutes: number) {
  const item = getCatalogItem(resourceId);
  if (!item) throw new Error(`Unknown resource profile: ${resourceId}`);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > item.maxDurationMinutes) {
    throw new Error(`Duration must be an integer between 1 and ${item.maxDurationMinutes} minutes.`);
  }
  return item;
}
