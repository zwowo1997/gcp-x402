---
name: gcp-x402-v3-preview
description: Build a temporary paper-only Hyperliquid BTC stack on operator-owned GCP without the user having a GCP account. Use for requests to browse priced GCP trading infrastructure, choose a 15/30/60-minute lease, pay end-to-end with Base Sepolia testnet USDC, or demonstrate a hosted MoonPay card/Apple Pay sandbox handoff.
---

# gcp-x402 native preview

Use the `gcp_x402` MCP tools for the entire journey. Do not orchestrate `npx` subprocesses after the native session starts.

## One-command start

An installed skill cannot add MCP tools to an already-running agent. If `v3_trading_catalog` is unavailable, give the user this **single command** in one terminal; it initializes private state and opens the correctly configured Codex session:

```bash
PROXY_URL=https://gcp-x402-v3-preview.example.invalid npx -y github:zwowo1997/gcp-x402 start
```

Do not first ask them to install a skill, run `setup`, or copy a second command. Continue only in the new Codex session it opens. The launcher pins this hosted origin in the MCP configuration and uses machine-level private state across project directories.

## Start

If the service is locked, ask the user for the operator-provided beta password and pass it directly to `unlock_service`. Never save, echo, or put the password in a shell command.

When the user first expresses an intent to build or deploy, ask this question **before** calling `wallet_info`, a catalog, or a quote. Do not ask it merely because the skill was installed:

> Which payment path would you like? **Testnet USDC** deploys the paper stack with Base Sepolia test tokens. **MoonPay sandbox** opens the hosted card/Apple Pay showcase and stops before payment or deployment.

If the user already chose a route in their intent, acknowledge that choice and do not ask again. The two routes are:

1. Base Sepolia testnet USDC — end-to-end temporary GCP provisioning.
2. MoonPay sandbox — hosted card/Apple Pay/KYC UX showcase; stops at the provider page.

Never combine the routes or treat MoonPay completion as deployment approval.

## Base Sepolia route

1. Call `wallet_info` and `v3_trading_catalog`.
2. Let the user choose 15, 30, or 60 minutes. Default to 15 minutes only if they ask for the cheapest/shortest demo.
3. Call `v3_trading_quote` with `paymentPath: "testnet-usdc"`, the duration, and requested paper-strategy limits.
4. Show:
   - estimated GCP usage;
   - exact expected testnet-USDC charge;
   - authorization ceiling;
   - unused allowance, which is never transferred;
   - expiry and every planned GCP service.
5. If wallet funds are insufficient, ask the user to fund the displayed address with Base Sepolia USDC. Never request a private key.
6. Ask a plain-language confirmation such as: “This paper-only stack runs for 15 minutes and costs exactly 0.09 testnet USDC. Deploy it?” A clear affirmative—“yes”, “approve”, “looks good”, or “go ahead”—approves that one fresh quote. Never require the user to repeat a quote ID, amount, duration, or scripted sentence. If there is no single fresh quote immediately preceding the response, clarify instead.
7. Only after that affirmative, call `v3_trading_deploy` once with the `quoteToken` and `userApproved: true`. Keep the token and exact quote fields internal. Never request a replacement quote after approval.

The client preserves one request ID across uncertain outcomes. Never create a fresh request or invoke a legacy `trading-deploy` fallback. On success, use `v3_trading_status` and `v3_trading_receipts` for recovery, then report the dashboard, lease expiry, settled amount, unused allowance, and exact GCP resource/cost rows.

## MoonPay route

After the user chooses MoonPay, call `moonpay_showcase` with their intent and duration. It returns a clickable official `buy-sandbox.moonpay.com` URL and attempts to open it from the current MCP session.

If desktop launch is unavailable, present the returned URL directly in chat. Do not ask the user to run another terminal command. Stop after the hosted MoonPay page opens. Do not consume a payment result, invoke x402, provision GCP, create a trading dashboard, or trade.

MoonPay test assets are on Ethereum Sepolia and do not fund Base Sepolia.

## Safety

Blank CLI or MCP output is never success. On DNS, network, or timeout failure, request the coding environment's outbound-network permission and rerun only the same idempotent operation. Never inspect a wallet file as a substitute for a live balance check or create a new deployment request to recover connectivity.

- Never collect card details, KYC data, seed phrases, or private keys.
- Every deployed strategy is paper-only; no Hyperliquid account or live/testnet exchange order is used.
- Require fresh exact-price approval before any paid tool.
- Never retry with a new request ID.
- Do not use V2 commands as a fallback.
