export type CatalogId = "vm.small" | "storage.small";

export interface CatalogItem {
  id: CatalogId;
  kind: "compute" | "storage";
  description: string;
  region: "us-central1";
  maxDurationMinutes: number;
  maxGcpCostUsd: number;
  priceCeilingUsd: number;
}

export const CATALOG: Record<CatalogId, CatalogItem> = {
  "vm.small": {
    id: "vm.small",
    kind: "compute",
    description: "Small ephemeral Compute Engine VM, deleted after one hour.",
    region: "us-central1",
    maxDurationMinutes: 60,
    maxGcpCostUsd: 0.25,
    priceCeilingUsd: 1,
  },
  "storage.small": {
    id: "storage.small",
    kind: "storage",
    description: "Small private regional Cloud Storage bucket for metadata-only demos.",
    region: "us-central1",
    maxDurationMinutes: 60,
    maxGcpCostUsd: 0.1,
    priceCeilingUsd: 0.5,
  },
};

export function getCatalogItem(id: string): CatalogItem | null {
  return CATALOG[id as CatalogId] ?? null;
}
