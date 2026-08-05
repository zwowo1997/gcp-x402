import { google } from "googleapis";
import { config } from "../config";
import { type PaperStrategyConfig, type TradingResources } from "./types";
import { sharedTradingSchema, tenantDeleteMutations } from "./shared-spanner";
import { tradingResourceName } from "./resource-name";

const managedBy = "gcp_x402";

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
    collectorService: tradingResourceName("hl-feed", stackId),
    writerService: tradingResourceName("hl-writer", stackId),
    strategyService: tradingResourceName("hl-paper", stackId),
    topic: tradingResourceName("hl-market", stackId),
    persistSubscription: tradingResourceName("hl-persist", stackId),
    strategySubscription: tradingResourceName("hl-strategy", stackId),
    tenantId: stackId,
    database: config.tradingSpannerDatabase,
  };
}

async function ensureSharedDatabase(): Promise<void> {
  const databasePath = `projects/${config.gcpProjectId}/instances/${config.tradingSpannerInstance}/databases/${config.tradingSpannerDatabase}`;
  try {
    await api(`https://spanner.googleapis.com/v1/${databasePath}`);
    return;
  } catch (error) {
    if (!String(error).includes("(404)")) throw error;
  }
  const path = `projects/${config.gcpProjectId}/instances/${config.tradingSpannerInstance}/databases`;
  const operation = await api<{ name: string }>(`https://spanner.googleapis.com/v1/${path}`, {
    method: "POST",
    body: JSON.stringify({
      createStatement: `CREATE DATABASE \`${config.tradingSpannerDatabase}\``,
      extraStatements: sharedTradingSchema,
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

async function createService(service: string, role: "collector" | "writer" | "strategy", topic: string, resources: TradingResources, strategyConfig: PaperStrategyConfig): Promise<string> {
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
            { name: "SPANNER_DATABASE", value: resources.database },
            { name: "TENANT_ID", value: resources.tenantId },
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
  await ensureSharedDatabase();
  const created: Array<() => Promise<void>> = [() => deleteTenantRows(resources)];
  try {
    await createTopic(resources.topic); created.push(() => deleteTopic(resources.topic));
    created.push(
      () => deleteService(resources.writerService),
      () => deleteService(resources.strategyService),
      () => deleteService(resources.collectorService),
    );
    // These services are independent after the topic exists. Creating them in
    // parallel keeps the paid request comfortably below MCP's normal deadline.
    const services = await Promise.allSettled([
      createService(resources.writerService, "writer", resources.topic, resources, strategyConfig),
      createService(resources.strategyService, "strategy", resources.topic, resources, strategyConfig),
      createService(resources.collectorService, "collector", resources.topic, resources, strategyConfig),
    ]);
    const rejected = services.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected) throw rejected.reason;
    const [writerUrl, strategyUrl, collectorUrl] = services.map((result) => (result as PromiseFulfilledResult<string>).value);
    if (!collectorUrl) throw new Error("Cloud Run collector did not return a URL.");

    created.push(
      () => deleteSubscription(resources.persistSubscription),
      () => deleteSubscription(resources.strategySubscription),
    );
    const subscriptions = await Promise.allSettled([
      createPushSubscription(resources.persistSubscription, resources.topic, writerUrl),
      createPushSubscription(resources.strategySubscription, resources.topic, strategyUrl),
    ]);
    const rejectedSubscription = subscriptions.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejectedSubscription) throw rejectedSubscription.reason;
  } catch (error) {
    await Promise.all(created.reverse().map((cleanup) => cleanup().catch(() => undefined)));
    throw error;
  }
}

async function deleteSubscription(subscription: string) { await api(`https://pubsub.googleapis.com/v1/projects/${config.gcpProjectId}/subscriptions/${subscription}`, { method: "DELETE" }); }
async function deleteTopic(topic: string) { await api(`https://pubsub.googleapis.com/v1/projects/${config.gcpProjectId}/topics/${topic}`, { method: "DELETE" }); }
async function deleteTenantRows(resources: TradingResources) {
  const database = `projects/${config.gcpProjectId}/instances/${config.tradingSpannerInstance}/databases/${resources.database}`;
  const result = await api<{ session?: Array<{ name: string }> }>(`https://spanner.googleapis.com/v1/${database}/sessions:batchCreate`, {
    method: "POST",
    body: JSON.stringify({ sessionCount: 1 }),
  });
  const session = result.session?.[0];
  if (!session) throw new Error("Spanner did not create a cleanup session.");
  try {
    await api(`https://spanner.googleapis.com/v1/${session.name}:commit`, {
      method: "POST",
      body: JSON.stringify({ singleUseTransaction: { readWrite: {} }, mutations: tenantDeleteMutations(resources) }),
    });
  } finally {
    await api(`https://spanner.googleapis.com/v1/${session.name}`, { method: "DELETE" }).catch(() => undefined);
  }
}
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
    deleteIfPresent(() => deleteTenantRows(resources)),
  ]);
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
