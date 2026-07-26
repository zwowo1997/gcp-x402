import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { dashboardSnapshot } from "@/lib/dashboard";

function money(n: number) { return `$${n.toFixed(4)}`; }

export default async function Dashboard() {
  const cookieStore = await cookies();
  if (!config.dashboardToken || cookieStore.get("gcp_x402_dashboard")?.value !== config.dashboardToken) redirect("/dashboard/login");
  const data = await dashboardSnapshot();
  return <main style={{ fontFamily: "system-ui", maxWidth: 1100, margin: "40px auto", padding: "0 20px", color: "#17202a" }}>
    <h1>gcp-x402 monitoring</h1>
    <p style={{ color: "#667085" }}>Service activity and provisioning exposure.</p>
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
      {[["Transactions", data.totals.transactions], ["Users", data.totals.users], ["Active resources", data.totals.activeResources], ["Settled", money(data.totals.settledUsd)], ["Refunded", money(data.totals.refundedUsd)], ["GCP exposure", money(data.totals.outstandingExposureUsd)]].map(([label, value]) => <div key={String(label)} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}><div style={{ color: "#667085", fontSize: 13 }}>{label}</div><strong style={{ fontSize: 24 }}>{value}</strong></div>)}
    </section>
    <h2>Services</h2>
    <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">Service</th><th align="left">Calls</th><th align="left">Users</th><th align="left">Settled</th><th align="left">Failed</th></tr></thead><tbody>{Object.entries(data.services).map(([name, row]) => <tr key={name}>{[name, row.calls, row.users, money(row.settledUsd), row.failed].map((v, i) => <td key={i} style={{ borderTop: "1px solid #eee", padding: "10px 6px" }}>{v}</td>)}</tr>)}</tbody></table>
    <h2>Recent transactions</h2>
    <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">Time</th><th align="left">Payer</th><th align="left">Service</th><th align="left">Operation</th><th align="left">Status</th><th align="left">Amount</th></tr></thead><tbody>{data.recentTransactions.map((tx) => <tr key={tx.id}>{[new Date(tx.createdAt).toLocaleString(), tx.payer.slice(0, 10), tx.service, tx.operation, tx.status, money(tx.settledAmountUsd ?? tx.requestedAmountUsd)].map((v, i) => <td key={i} style={{ borderTop: "1px solid #eee", padding: "8px 6px", fontSize: 13 }}>{v}</td>)}</tr>)}</tbody></table>
  </main>;
}
