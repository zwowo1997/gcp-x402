import { google } from "googleapis";
import { config } from "../config";
import { type PaperStrategyConfig, type TradingResources } from "./types";
import { listTradingStacks } from "./store";

const managedBy = "gcp_x402";

function idPart(value: string) { return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 24); }
function resourceName(prefix: string, stackId: string) { return `${prefix}-${idPart(stackId)}`.slice(0, 49); }

async function accessToken(): Promise<string> {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Unable to obtain GCP access token.");
  return token;
}

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`GCP API ${init.method ?? "GET"} ${url} failed (${response.status}): ${await response.text()}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

async function waitForOperation(operationName: string, apiBase: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const operation = await api<{ done?: boolean; error?: { message?: string } }>(`${apiBase}/${operationName}`);
    if (operation.done) {
      if (operation.error) throw new Error(`GCP operation failed: ${operation.error.message ?? "unknown error"}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for GCP operation ${operationName}.`);
}

function requiredRuntimeConfig() {
  if (!config.tradingImage || !config.tradingRuntimeServiceAccount || !config.tradingPubsubPushServiceAccount) {
    throw new Error("TRADING_IMAGE, TRADING_RUNTIME_SERVICE_ACCOUNT, and TRADING_PUBSUB_PUSH_SERVICE_ACCOUNT are required before deploying a paper trading stack.");
  }
  return { image: config.tradingImage, runtimeServiceAccount: config.tradingRuntimeServiceAccount, pushServiceAccount: config.tradingPubsubPushServiceAccount };
}

export function tradingResources(stackId: string): TradingResources {
  return {
    collectorService: resourceName("hl-feed", stackId),
    writerService: resourceName("hl-writer", stackId),
    strategyService: resourceName("hl-paper", stackId),
    topic: resourceName("hl-market", stackId),
    persistSubscription: resourceName("hl-persist", stackId),
    strategySubscription: resourceName("hl-strategy", stackId),
    database: resourceName("hl", stackId).replace(/-/g, "_"),
  };
}

async function ensureSpannerInstance(): Promise<void> {
  const instancePath = `projects/${config.gcpProjectId}/instances/${config.tradingSpannerInstance}`;
  try {
    await api(`https://spanner.googleapis.com/v1/${instancePath}`);
    return;
  } catch (error) {
    if (!String(error).includes("(404)")) throw error;
  }
  const operation = await api<{ name: string }>(`https://spanner.googleapis.com/v1/projects/${config.gcpProjectId}/instances?instanceId=${encodeURIComponent(config.tradingSpannerInstance)}`, {
    method: "POST",
    body: JSON.stringify({ config: `projects/${config.gcpProjectId}/instanceConfigs/regional-${config.tradingRegion}`, displayName: "gcp-x402 trading", processingUnits: 100, labels: { managed_by: managedBy } }),
  });
  await waitForOperation(operation.name, "https://spanner.googleapis.com/v1");
}

async function createDatabase(resources: TradingResources): Promise<void> {
  const path = `projects/${config.gcpProjectId}/instances/${config.tradingSpannerInstance}/databases`;
  const operation = await api<{ name: string }>(`https://spanner.googleapis.com/v1/${path}`, {
    method: "POST",
    body: JSON.stringify({
      createStatement: `CREATE DATABASE \`${resources.database}\``,
      extraStatements: [
        "CREATE TABLE MarketSnapshots (event_id STRING(64) NOT NULL, observed_at TIMESTAMP NOT NULL, symbol STRING(16) NOT NULL, mid FLOAT64, raw_json STRING(MAX), commit_ts TIMESTAMP OPTIONS (allow_commit_timestamp=true)) PRIMARY KEY (event_id)",
        "CREATE TABLE Candles (candle_id STRING(64) NOT NULL, opened_at TIMESTAMP NOT NULL, symbol STRING(16) NOT NULL, open FLOAT64, high FLOAT64, low FLOAT64, close FLOAT64, volume FLOAT64) PRIMARY KEY (candle_id)",
        "CREATE TABLE StrategyState (state_key STRING(64) NOT NULL, updated_at TIMESTAMP NOT NULL, payload STRING(MAX)) PRIMARY KEY (state_key)",
        "CREATE TABLE SimulatedOrders (order_id STRING(64) NOT NULL, created_at TIMESTAMP NOT NULL, side STRING(8) NOT NULL, quantity FLOAT64, price FLOAT64, status STRING(24), payload STRING(MAX)) PRIMARY KEY (order_id)",
        "CREATE TABLE StackEvents (event_id STRING(64) NOT NULL, created_at TIMESTAMP NOT NULL, type STRING(32), message STRING(MAX), payload STRING(MAX)) PRIMARY KEY (event_id)",
      ],
    }),
  });
  await waitForOperation(operation.name, "https://spanner.googleapis.com/v1");
}

async function createTopic(topic: string): Promise<void> {
  await api(`https://pubsub.googleapis.com/v1/projects/${config.gcpProjectId}/topics/${topic}`, {
    method: "PUT",
    body: JSON.stringify({ labels: { managed_by: managedBy }, messageStoragePolicy: { allowedPersistenceRegions: [config.tradingRegion] } }),
  });
}

function serviceUrl(service: string) { return `https://run.googleapis.com/v2/projects/${config.gcpProjectId}/locations/${config.tradingRegion}/services/${service}`; }

async function grantPubsubInvoker(service: string): Promise<void> {
  const runtime = requiredRuntimeConfig();
  const policy = await api<{ bindings?: Array<{ role: string; members?: string[] }>; etag?: string }>(`${serviceUrl(service)}:getIamPolicy`);
  const member = `serviceAccount:${runtime.pushServiceAccount}`;
  const bindings = policy.bindings ?? [];
  const invoker = bindings.find((binding) => binding.role === "roles/run.invoker");
  if (invoker?.members?.includes(member)) return;
  if (invoker) invoker.members = [...(invoker.members ?? []), member];
  else bindings.push({ role: "roles/run.invoker", members: [member] });
  await api(`${serviceUrl(service)}:setIamPolicy`, {
    method: "POST",
    body: JSON.stringify({ policy: { bindings, etag: policy.etag } }),
  });
}

async function createService(service: string, role: "collector" | "writer" | "strategy", topic: string, database: string, strategyConfig: PaperStrategyConfig): Promise<string> {
  const runtime = requiredRuntimeConfig();
  const operation = await api<{ name: string }>(`https://run.googleapis.com/v2/projects/${config.gcpProjectId}/locations/${config.tradingRegion}/services?serviceId=${encodeURIComponent(service)}`, {
    method: "POST",
    body: JSON.stringify({
      labels: { managed_by: managedBy, paper_only: "true" },
      template: {
        serviceAccount: runtime.runtimeServiceAccount,
        timeout: "60s",
        scaling: { minInstanceCount: role === "collector" ? 1 : 0, maxInstanceCount: 1 },
        containers: [{
          image: runtime.image,
          env: [
            { name: "ROLE", value: role },
            { name: "PAPER_ONLY", value: "true" },
            { name: "GCP_PROJECT_ID", value: config.gcpProjectId },
            { name: "PUBSUB_TOPIC", value: topic },
            { name: "SPANNER_INSTANCE", value: config.tradingSpannerInstance },
            { name: "SPANNER_DATABASE", value: database },
            { name: "HYPERLIQUID_WS_URL", value: "wss://api.hyperliquid.xyz/ws" },
            { name: "FAST_EMA", value: String(strategyConfig.fastEma) },
            { name: "SLOW_EMA", value: String(strategyConfig.slowEma) },
            { name: "EVALUATION_INTERVAL_SECONDS", value: String(strategyConfig.evaluationIntervalSeconds) },
            { name: "VIRTUAL_BALANCE_USD", value: String(strategyConfig.virtualBalanceUsd) },
            { name: "MAX_ORDER_NOTIONAL_USD", value: String(strategyConfig.maxOrderNotionalUsd) },
            { name: "MAX_POSITION_NOTIONAL_USD", value: String(strategyConfig.maxPositionNotionalUsd) },
            { name: "MAX_DAILY_LOSS_USD", value: String(strategyConfig.maxDailyLossUsd) },
            { name: "SLIPPAGE_BPS", value: String(strategyConfig.slippageBps) },
          ],
          resources: { limits: { cpu: "1", memory: "512Mi" }, cpuIdle: role !== "collector" },
        }],
      },
    }),
  });
  await waitForOperation(operation.name, "https://run.googleapis.com/v2");
  if (role !== "collector") await grantPubsubInvoker(service);
  const result = await api<{ uri?: string }>(serviceUrl(service));
  if (!result.uri) throw new Error(`Cloud Run service ${service} did not return a URL.`);
  return result.uri;
}

async function createPushSubscription(subscription: string, topic: string, endpoint: string): Promise<void> {
  const runtime = requiredRuntimeConfig();
  await api(`https://pubsub.googleapis.com/v1/projects/${config.gcpProjectId}/subscriptions/${subscription}`, {
    method: "PUT",
    body: JSON.stringify({
      topic: `projects/${config.gcpProjectId}/topics/${topic}`,
      ackDeadlineSeconds: 30,
      pushConfig: { pushEndpoint: `${endpoint}/events`, oidcToken: { serviceAccountEmail: runtime.pushServiceAccount } },
      labels: { managed_by: managedBy, paper_only: "true" },
    }),
  });
}

export async function createTradingStackResources(resources: TradingResources, strategyConfig: PaperStrategyConfig): Promise<void> {
  await ensureSpannerInstance();
  const created: Array<() => Promise<void>> = [];
  try {
    await createDatabase(resources); created.push(() => deleteDatabase(resources.database));
    await createTopic(resources.topic); created.push(() => deleteTopic(resources.topic));
    const writerUrl = await createService(resources.writerService, "writer", resources.topic, resources.database, strategyConfig); created.push(() => deleteService(resources.writerService));
    await createPushSubscription(resources.persistSubscription, resources.topic, writerUrl); created.push(() => deleteSubscription(resources.persistSubscription));
    const strategyUrl = await createService(resources.strategyService, "strategy", resources.topic, resources.database, strategyConfig); created.push(() => deleteService(resources.strategyService));
    await createPushSubscription(resources.strategySubscription, resources.topic, strategyUrl); created.push(() => deleteSubscription(resources.strategySubscription));
    const collectorUrl = await createService(resources.collectorService, "collector", resources.topic, resources.database, strategyConfig); created.push(() => deleteService(resources.collectorService));
    if (!collectorUrl) throw new Error("Cloud Run collector did not return a URL.");
  } catch (error) {
    await Promise.all(created.reverse().map((cleanup) => cleanup().catch(() => undefined)));
    throw error;
  }
}

async function deleteSubscription(subscription: string) { await api(`https://pubsub.googleapis.com/v1/projects/${config.gcpProjectId}/subscriptions/${subscription}`, { method: "DELETE" }); }
async function deleteTopic(topic: string) { await api(`https://pubsub.googleapis.com/v1/projects/${config.gcpProjectId}/topics/${topic}`, { method: "DELETE" }); }
async function deleteDatabase(database: string) { await api(`https://spanner.googleapis.com/v1/projects/${config.gcpProjectId}/instances/${config.tradingSpannerInstance}/databases/${database}`, { method: "DELETE" }); }
async function deleteService(service: string) {
  const operation = await api<{ name?: string }>(serviceUrl(service), { method: "DELETE" });
  if (operation.name) await waitForOperation(operation.name, "https://run.googleapis.com/v2");
}

/** GCP deletion is idempotent: a retry after a successful delete sees a 404. */
async function deleteIfPresent(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!String(error).includes("(404)")) throw error;
  }
}

export async function deleteTradingStackResources(resources: TradingResources): Promise<void> {
  // Do not mark a stack terminal unless every resource is gone. The Cloud Task
  // will retry this operation; treating 404 as success makes those retries safe.
  await Promise.all([
    deleteIfPresent(() => deleteSubscription(resources.persistSubscription)),
    deleteIfPresent(() => deleteSubscription(resources.strategySubscription)),
    deleteIfPresent(() => deleteService(resources.collectorService)),
    deleteIfPresent(() => deleteService(resources.writerService)),
    deleteIfPresent(() => deleteService(resources.strategyService)),
  ]);
  await Promise.all([
    deleteIfPresent(() => deleteTopic(resources.topic)),
    deleteIfPresent(() => deleteDatabase(resources.database)),
  ]);
}

/** Remove the shared 100-PU test instance only after the last managed paper stack ends. */
export async function deleteUnusedTradingSpannerInstance(): Promise<void> {
  const active = (await listTradingStacks()).some((stack) => !["shutdown", "expired", "failed"].includes(stack.status));
  if (active) return;
  const instanceUrl = `https://spanner.googleapis.com/v1/projects/${config.gcpProjectId}/instances/${config.tradingSpannerInstance}`;
  try {
    const instance = await api<{ labels?: Record<string, string> }>(instanceUrl);
    if (instance.labels?.managed_by !== managedBy) return;
    const operation = await api<{ name?: string }>(instanceUrl, { method: "DELETE" });
    if (operation.name) await waitForOperation(operation.name, "https://spanner.googleapis.com/v1");
  } catch (error) {
    if (!String(error).includes("(404)")) throw error;
  }
}

export async function stopTradingStackResources(resources: TradingResources): Promise<void> {
  await Promise.all([
    deleteIfPresent(() => deleteSubscription(resources.persistSubscription)),
    deleteIfPresent(() => deleteSubscription(resources.strategySubscription)),
  ]);
}

export async function resumeTradingStackResources(resources: TradingResources): Promise<void> {
  const strategy = await api<{ uri?: string }>(serviceUrl(resources.strategyService));
  const writer = await api<{ uri?: string }>(serviceUrl(resources.writerService));
  if (!strategy.uri || !writer.uri) throw new Error("Cannot resume a missing Cloud Run service.");
  await createPushSubscription(resources.strategySubscription, resources.topic, strategy.uri);
  await createPushSubscription(resources.persistSubscription, resources.topic, writer.uri);
}
