---
name: gcp-x402-v3-preview
description: Rehearse a private-beta, no-wallet checkout for temporary GCP infrastructure and a paper-only Hyperliquid stack. Use for internal demos involving Apple Pay, Coinbase-style onramp, or cloud infrastructure without a GCP account. This preview never charges money or creates cloud/trading resources.
---

# gcp-x402 v3 preview

Use only this isolated v3 simulation workflow. Never invoke legacy commands such as `wallet`, `query`, `provision`, `trading-deploy`, or any x402 payment flow from this skill.

This is a realistic interface rehearsal. It does not charge Apple Pay, perform KYC, move USDC, provision tenant resources, subscribe to Hyperliquid, or place an order.

## Unlock in the user's current project

The unlock session is directory-specific. Before giving the command, determine and print the user's exact working directory. Ask them to run this in their interactive terminal, replacing `<CURRENT_PROJECT_DIRECTORY>` with that exact directory:

```bash
cd "<CURRENT_PROJECT_DIRECTORY>"
PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402#agent/v3-ap2-onramp-sandbox unlock
```

The private-beta operator gives the password to authorized testers. Never reveal, guess, store, or embed it. After the user confirms unlock, continue in the same directory.

## Rehearse the journey

1. Read the simulation catalog:

   ```bash
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402#agent/v3-ap2-onramp-sandbox v3-catalog
   ```

2. Explain the selected duration, expected simulated settlement, authorization cap, and exact estimated service allocation. Ask once for approval to begin the free rehearsal.
3. Create exactly one simulation. For the full trading demo:

   ```bash
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402#agent/v3-ap2-onramp-sandbox v3-simulate trading.paper.ema 15
   ```

4. Return the `dashboardUrl` immediately. Tell the user it shows a simulated embedded wallet, Apple Pay authorization, resource estimates, BTC paper-strategy telemetry, lifecycle controls, and automatic expiry.
5. Let the user operate the checkout from the dashboard. If they ask the agent to operate it, use only the returned stack ID with:

   ```bash
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402#agent/v3-ap2-onramp-sandbox v3-status <STACK_ID>
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402#agent/v3-ap2-onramp-sandbox v3-control <STACK_ID> <approve|fund|provision|stop|resume|shutdown|cancel>
   ```

Do not create a second simulation to recover a timeout. Query the first stack with `v3-status`. Never ask the user for an EVM address, wallet funding, GCP credentials, card details, or KYC information.

## Successful handoff

Report:

- the dashboard URL and expiry;
- simulation status and simulated payment status;
- each displayed GCP service, region, role, and estimated allocation;
- the expected simulated final settlement and maximum authorization;
- the explicit statement: “No money transferred and no cloud or trading resources were created.”
