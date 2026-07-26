import { listJobs, listTransactions, type TransactionRecord } from "./store";

export async function dashboardSnapshot() {
  const [jobs, transactions] = await Promise.all([listJobs(), listTransactions()]);
  const users = new Set(transactions.map((t) => t.payer).filter(Boolean));
  const settled = transactions.reduce((n, t) => n + (t.settledAmountUsd ?? 0), 0);
  const refunded = transactions.reduce((n, t) => n + (t.refundedAmountUsd ?? 0), 0);
  const active = jobs.filter((j) => j.status === "active");
  const exposure = jobs.filter((j) => !["closed", "failed"].includes(j.status)).reduce((n, j) => n + j.maxGcpCostUsd, 0);
  const byService = (service: TransactionRecord["service"]) => {
    const rows = transactions.filter((t) => t.service === service);
    return { calls: rows.length, users: new Set(rows.map((r) => r.payer)).size, settledUsd: rows.reduce((n, r) => n + (r.settledAmountUsd ?? 0), 0), failed: rows.filter((r) => r.status === "failed").length };
  };
  return { totals: { transactions: transactions.length, users: users.size, settledUsd: settled, refundedUsd: refunded, activeResources: active.length, outstandingExposureUsd: exposure }, services: { bigquery: byService("bigquery"), compute: byService("compute"), storage: byService("storage") }, resources: { active: active.length, closed: jobs.filter((j) => j.status === "closed").length, failed: jobs.filter((j) => j.status === "failed").length }, recentTransactions: transactions.slice(0, 50) };
}
