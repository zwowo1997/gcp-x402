---
name: gcp-x402-v3-preview
description: Set up a paper-only Hyperliquid or temporary GCP demo without the user owning a GCP account. Always offer two payment experiences first: an end-to-end Base Sepolia x402 route using testnet USDC, or a real-money on-ramp showcase that opens MoonPay sandbox and stops before payment or provisioning.
---

# gcp-x402 payment choice

Work from the user's exact working directory (their current project directory). Before running payment or deployment commands, ask:

> Which payment experience do you want?
> 1. **Testnet USDC** — complete the established Base Sepolia x402 flow and create the one-hour paper stack.
> 2. **Real-money on-ramp showcase** — open MoonPay's hosted sandbox login and stop there. No charge, x402 settlement, GCP resource, dashboard, or trade follows.

If the user already chose one, do not ask again. Never combine the routes or treat MoonPay completion as authorization for the testnet deployment.

## Option 1: Base Sepolia testnet USDC

This is the only end-to-end provisioning route. It uses the V2 Tokyo service and testnet USDC.

1. Unlock in the exact directory:

   ```bash
   cd "<CURRENT_PROJECT_DIRECTORY>"
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402 unlock
   ```

2. Inspect the wallet and profile:

   ```bash
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402 wallet
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app npx -y github:zwowo1997/gcp-x402 trading-catalog
   ```

3. If needed, ask the user to fund the displayed address with Base Sepolia USDC. Never request a private key. State that the stack is paper-only, expires in one hour, and costs at most `$5.00` testnet USDC. Obtain explicit approval once.
4. After funding and approval, invoke exactly once:

   ```bash
   PROXY_URL=https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app MAX_PAYMENT_USD=5.00 npx -y github:zwowo1997/gcp-x402 trading-deploy
   ```

Do not retry with a new request. On uncertain output, run `trading-receipts`; then resume ordinary `trading-deploy` at most once so it reuses the pending idempotency key. Never use `--new` unless the user explicitly requests and approves another independent stack.

After success, return the monitoring dashboard and list every provisioned GCP service, resource name, region, estimated one-hour allocation, x402 payment, estimated GCP usage, and service/risk buffer from the receipt. The dashboard is for strategy telemetry, GCP resources, costs, lease status, and stop/resume/shutdown controls—not payment or wallet UI.

## Option 2: MoonPay on-ramp showcase

This route demonstrates provider-owned card/Apple Pay/KYC UX. It must stop immediately after redirecting to MoonPay sandbox.

1. Prepare one local plan:

   ```bash
   cd "<CURRENT_PROJECT_DIRECTORY>"
   npx -y github:zwowo1997/gcp-x402 setup --sandbox
   npx -y github:zwowo1997/gcp-x402 plan "<USER_INTENT>"
   ```

2. Unlock the V3 preview from the same directory:

   ```bash
   PROXY_URL=https://gcp-x402-v3-preview.example.invalid npx -y github:zwowo1997/gcp-x402 unlock
   ```

3. Ask the user to run this in their interactive terminal so they see the top-up screen and control the browser handoff:

   ```bash
   PROXY_URL=https://gcp-x402-v3-preview.example.invalid npx -y github:zwowo1997/gcp-x402 topup moonpay <PLAN_ID>
   ```

The command may open only `https://buy-sandbox.moonpay.com`. Once MoonPay login opens, report success and stop. Do not wait for payment, inspect KYC, call `checkout`, advance V3 simulation state, invoke x402, deploy resources, or return a dashboard. Clearly state that MoonPay test assets are on Ethereum Sepolia and do not fund Base Sepolia.

## Safety

- Never collect card details, KYC data, seed phrases, or private keys.
- MoonPay sandbox and Base Sepolia x402 are separate demonstrations.
- The MoonPay route cannot provision or trade.
- The testnet route provisions billable operator-owned GCP resources only after explicit approval and automatically expires them after one hour.
