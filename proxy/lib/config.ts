// Centralized, validated configuration for the gcp-x402 proxy.
// Everything is read from environment variables so the same image runs on
// testnet or mainnet with no code changes.

import { base, baseSepolia } from "./networks";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function reqWhen(condition: boolean, name: string): string | undefined {
  if (!condition) return process.env[name]?.trim();
  return req(name);
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number, got "${v}"`);
  return n;
}

const networkName = process.env.X402_NETWORK ?? "base-sepolia";
const network = networkName === "base" ? base : baseSepolia;

export const config = {
  testMode: process.env.TEST_MODE !== "false",
  maxGcpCostPerProvisionUsd: num("MAX_GCP_COST_PER_PROVISION_USD", 5),
  maxOutstandingGcpExposureUsd: num("MAX_OUTSTANDING_GCP_EXPOSURE_USD", 20),
  dashboardToken: process.env.DASHBOARD_TOKEN?.trim(),
  /** Private-beta password and independent signing key; both come from Secret Manager in production. */
  betaAccessPassword: reqWhen(process.env.NODE_ENV === "production", "BETA_ACCESS_PASSWORD"),
  betaSessionSecret: reqWhen(process.env.NODE_ENV === "production", "BETA_SESSION_SECRET"),
  betaSessionTtlSeconds: num("BETA_SESSION_TTL_SECONDS", 8 * 60 * 60),
  maxRentalMinutes: num("MAX_RENTAL_MINUTES", 60),
  /** HMAC secret for opaque resource-management capabilities. */
  resourceCapabilitySecret: reqWhen(process.env.NODE_ENV === "production", "RESOURCE_CAPABILITY_SECRET"),
  /** Cloud Tasks configuration is mandatory for paid provisioning in production. */
  tasksQueue: process.env.CLOUD_TASKS_QUEUE,
  tasksLocation: process.env.CLOUD_TASKS_LOCATION ?? "us-central1",
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.replace(/\/$/, ""),
  cleanupToken: reqWhen(Boolean(process.env.CLOUD_TASKS_QUEUE), "CLEANUP_TOKEN"),
  // --- Hyperliquid paper trading -------------------------------------------
  tradingRegion: process.env.TRADING_REGION ?? "asia-northeast1",
  tradingSpannerInstance: process.env.TRADING_SPANNER_INSTANCE ?? "hyperliquid-test",
  tradingSpannerDatabase: process.env.TRADING_SPANNER_DATABASE ?? "hyperliquid-demo",
  tradingRuntimeServiceAccount: process.env.TRADING_RUNTIME_SERVICE_ACCOUNT,
  tradingPubsubPushServiceAccount: process.env.TRADING_PUBSUB_PUSH_SERVICE_ACCOUNT,
  tradingImage: process.env.TRADING_IMAGE,
  tradingDashboardUrl: process.env.TRADING_DASHBOARD_URL?.replace(/\/$/, ""),
  tradingLeaseHours: num("TRADING_LEASE_HOURS", 24),
  tradingPaymentTimeoutSeconds: num("TRADING_PAYMENT_TIMEOUT_SECONDS", 600),
  // --- BigQuery -------------------------------------------------------------
  /** Billing project that runs the jobs (NOT the public-data project). */
  gcpProjectId: req("GCP_PROJECT_ID"),
  /**
   * Service-account credentials as inline JSON (for hosts without a GCP identity) — the
   * @google-cloud/bigquery client also honors GOOGLE_APPLICATION_CREDENTIALS
   * (a file path) when this is unset.
   */
  gcpCredentialsJson: process.env.GCP_SERVICE_ACCOUNT_JSON,
  /** Only datasets under these GCP projects may be queried. */
  allowedProjects: (process.env.ALLOWED_PROJECTS ?? "bigquery-public-data")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** US on-demand location for jobs; public datasets live in the US multi-region. */
  bqLocation: process.env.BQ_LOCATION ?? "US",
  /** Hard wall: refuse to even price a query whose dry run exceeds this. */
  maxBytesPerQuery: num("MAX_BYTES_PER_QUERY", 100 * 2 ** 40), // 100 TiB
  /** Inline result row cap before we mark the response truncated. */
  maxInlineRows: num("MAX_INLINE_ROWS", 10_000),
  /** Per-query statement timeout (ms). */
  queryTimeoutMs: num("QUERY_TIMEOUT_MS", 60_000),
  /**
   * Headroom on maximum_bytes_billed at execution time. The dry-run estimate
   * and the actually-billed bytes can differ slightly (BigQuery rounds billed
   * bytes up), so an exact cap spuriously fails real queries. We still charge
   * the quoted price; this buffer just stops a benign rounding delta from
   * killing the job. MAX_BYTES_PER_QUERY remains the real runaway guard.
   */
  byteCapBuffer: num("BYTE_CAP_BUFFER", 1.2),

  // --- Pricing --------------------------------------------------------------
  usdPerByte: num("USD_PER_BYTE", 6.25 / 2 ** 40), // ~$6.25 / TiB, US on-demand
  markup: num("PRICE_MARKUP", 2.0),
  priceFloorUsd: num("PRICE_FLOOR_USD", 0.002),
  minBytesPerTable: num("MIN_BYTES_PER_TABLE", 10 * 10 ** 6), // BigQuery's 10 MB/table floor

  // --- x402 / settlement ----------------------------------------------------
  network,
  /** Address that receives USDC for queries. */
  payTo: req("PAY_TO_ADDRESS"),
  /** Facilitator base URL exposing POST /verify and POST /settle. */
  facilitatorUrl: (process.env.FACILITATOR_URL ?? "https://x402.org/facilitator").replace(/\/$/, ""),
  /** Optional bearer for authenticated facilitators (e.g. CDP). */
  facilitatorApiKey: process.env.FACILITATOR_API_KEY,
  /** How long a quote/payment authorization stays valid. */
  quoteTtlSeconds: num("QUOTE_TTL_SECONDS", 60),

  // --- Quote signing --------------------------------------------------------
  quoteSecret: req("QUOTE_SECRET"),
} as const;

export type AppConfig = typeof config;
