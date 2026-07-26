"use client";

import { FormEvent, useState } from "react";

export default function DashboardLogin() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/dashboard/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    if (!res.ok) { setError("Invalid dashboard token."); return; }
    window.location.assign("/dashboard");
  }
  return <main style={{ fontFamily: "system-ui", maxWidth: 380, margin: "15vh auto", padding: 24 }}><h1>gcp-x402 monitoring</h1><form onSubmit={submit}><label>Dashboard token<input autoFocus type="password" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: "100%", margin: "8px 0 12px", padding: 9 }} /></label><button type="submit">Open dashboard</button>{error && <p style={{ color: "#b42318" }}>{error}</p>}</form></main>;
}
