import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

function secret(): string {
  if (!config.resourceCapabilitySecret) throw new Error("RESOURCE_CAPABILITY_SECRET must be configured for resource management.");
  return config.resourceCapabilitySecret;
}

export function issueResourceCapability(jobId: string, payer: string): string {
  return createHmac("sha256", secret()).update(`${jobId}:${payer.toLowerCase()}`, "utf8").digest("base64url");
}

export function hasResourceCapability(jobId: string, payer: string, token: string | null): boolean {
  if (!token) return false;
  const expected = issueResourceCapability(jobId, payer);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
