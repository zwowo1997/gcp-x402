---
name: gcp-x402-v3-preview
description: Rehearse a private-beta, no-wallet checkout for temporary GCP infrastructure and a paper-only Hyperliquid stack. Use for internal demos involving Apple Pay, Coinbase-style onramp, or cloud infrastructure without a GCP account. This preview never charges money or creates cloud/trading resources.
---

# gcp-x402 v3 preview

Use only this isolated v3 simulation workflow. Never invoke legacy commands such as `wallet`, `query`, `provision`, `trading-deploy`, or any x402 payment flow from this skill.

This is a realistic interface rehearsal. It does not charge Apple Pay, perform KYC, move USDC, provision tenant resources, subscribe to Hyperliquid, or place an order.

## Start a safe sandbox in the user's current project

Before checkout, determine and print the user's exact working directory. Ask them to initialize the local test wallet there. It creates no real wallet balance, payment, cloud resource, or trade:

```bash
cd "<CURRENT_PROJECT_DIRECTORY>"
npx -y github:zwowo1997/gcp-x402 setup --sandbox
```

The command returns the assigned test-only Base Sepolia address and virtual USDC balance. Do not request a private key, card information, KYC information, or a real wallet. The private-beta unlock is needed only when creating the protected checkout.

## Rehearse the journey

1. Turn the user’s intent into exactly one allowlisted plan:

   ```bash
   npx -y github:zwowo1997/gcp-x402 plan "<USER_INTENT>"
   ```

2. Explain the selected duration, expected simulated settlement, authorization cap, test wallet address, and exact estimated service allocation. Ask once for approval to begin the free rehearsal.
3. After approval, unlock from the same exact directory. The private-beta operator gives the password to authorized testers; never reveal, guess, store, or embed it:

   ```bash
   cd "<CURRENT_PROJECT_DIRECTORY>"
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402 unlock
   ```

4. Create exactly one checkout from the returned `planId`:

   ```bash
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402 checkout <PLAN_ID>
   ```

5. Return the `dashboardUrl` immediately. Tell the user it shows the assigned sandbox wallet, simulated Apple Pay authorization, resource estimates, BTC paper-strategy telemetry, lifecycle controls, automatic expiry, and payment trace.
6. Let the user operate the checkout from the dashboard. If they ask the agent to inspect it, use only the returned checkout ID with:

   ```bash
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402 status <CHECKOUT_ID>
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402 debugger <CHECKOUT_ID>
   ```

Do not create a second checkout to recover a timeout. Query the first checkout with `status`. Never ask the user for an EVM address, wallet funding, GCP credentials, card details, or KYC information.

## Successful handoff

Report:

- the dashboard URL and expiry;
- simulation status and simulated payment status;
- each displayed GCP service, region, role, and estimated allocation;
- the expected simulated final settlement and maximum authorization;
- the explicit statement: “No money transferred and no cloud or trading resources were created.”
