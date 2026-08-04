"use client";

export default function MoonPayReturnPage() {
  return <main>
    <section>
      <span>MOONPAY TEST MODE</span>
      <h1>Return to your original dashboard</h1>
      <p>MoonPay has returned control to gcp-x402. This tab cannot provision GCP resources or settle x402, and no dashboard session was placed in the redirect URL.</p>
      <button onClick={() => window.close()}>Close this tab</button>
    </section>
    <style jsx>{`:global(body){margin:0;background:#07111d;color:#e8f0fa;font-family:Inter,system-ui,sans-serif}main{min-height:100vh;display:grid;place-items:center;padding:24px}section{max-width:560px;border:1px solid #24435d;background:#0d1b2a;border-radius:14px;padding:28px}span{font-size:12px;letter-spacing:.12em;color:#63d8e8;font-weight:800}h1{margin:10px 0}p{color:#afc0d1;line-height:1.55}button{background:#2e83d8;border:0;color:white;border-radius:7px;padding:11px 14px;font-weight:750;cursor:pointer}`}</style>
  </main>;
}
