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

export function issueDashboardAccess(stackId: string, payer: string, expiresAt: string): string {
  const body = Buffer.from(JSON.stringify({ stackId, payer: payer.toLowerCase(), expiresAt }), "utf8").toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(`dashboard:${body}`).digest("base64url")}`;
}

export function hasDashboardAccess(stackId: string, payer: string, token: string | null): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf("."); if (dot < 1) return false;
  const body = token.slice(0, dot), supplied = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(createHmac("sha256", secret()).update(`dashboard:${body}`).digest("base64url"));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try { const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); return value.stackId === stackId && value.payer === payer.toLowerCase() && new Date(value.expiresAt).getTime() > Date.now(); }
  catch { return false; }
}
