import { google } from "googleapis";
import { config } from "../config";
import { type TradingResources } from "./types";

type SpannerValue = { stringValue?: string; numberValue?: number; timestampValue?: string; nullValue?: null };

async function token(): Promise<string> {
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const value = await auth.getAccessToken();
  if (!value) throw new Error("Unable to obtain GCP access token for trading metrics.");
  return value;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Spanner metrics request failed (${response.status}): ${await response.text()}`);
  return response.status === 204 ? undefined as T : await response.json() as T;
}

function valueOf(value: SpannerValue | undefined): string | number | null {
  if (!value || "nullValue" in value) return null;
  return value.stringValue ?? value.timestampValue ?? value.numberValue ?? null;
}

async function sql(resources: TradingResources, statement: string): Promise<Array<Record<string, string | number | null>>> {
  const database = `projects/${config.gcpProjectId}/instances/${config.tradingSpannerInstance}/databases/${resources.database}`;
  const session = await request<{ name: string }>(`https://spanner.googleapis.com/v1/${database}/sessions`, { method: "POST", body: "{}" });
  try {
    const result = await request<{ metadata?: { rowType?: { fields?: Array<{ name: string }> } }; rows?: Array<{ values?: SpannerValue[] }> }>(`https://spanner.googleapis.com/v1/${session.name}:executeSql`, { method: "POST", body: JSON.stringify({ sql: statement }) });
    const fields = result.metadata?.rowType?.fields?.map((field) => field.name) ?? [];
    return (result.rows ?? []).map((row) => Object.fromEntries(fields.map((field, index) => [field, valueOf(row.values?.[index])]))) as Array<Record<string, string | number | null>>;
  } finally {
    await request(`https://spanner.googleapis.com/v1/${session.name}`, { method: "DELETE" }).catch(() => undefined);
  }
}

export async function tradingMetrics(resources: TradingResources) {
  const [marketDescending, stateRows, orders] = await Promise.all([
    sql(resources, "SELECT observed_at, mid FROM MarketSnapshots WHERE symbol = 'BTC' ORDER BY observed_at DESC LIMIT 48"),
    sql(resources, "SELECT payload FROM StrategyState WHERE state_key = 'current' LIMIT 1"),
    sql(resources, "SELECT created_at, side, quantity, price, status FROM SimulatedOrders ORDER BY created_at DESC LIMIT 10"),
  ]);
  let strategy: Record<string, unknown> | null = null;
  const payload = stateRows[0]?.payload;
  if (typeof payload === "string") {
    try { strategy = JSON.parse(payload) as Record<string, unknown>; } catch { /* Corrupt telemetry must not break the dashboard. */ }
  }
  return { market: marketDescending.reverse(), strategy, orders };
}
