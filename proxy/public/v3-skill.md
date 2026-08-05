---
name: gcp-x402-v3-preview
description: Build a temporary paper-only Hyperliquid BTC stack on operator-owned GCP without the user having a GCP account. Use for requests to browse priced GCP trading infrastructure, choose a 15/30/60-minute lease, pay end-to-end with Base Sepolia testnet USDC, or demonstrate a hosted MoonPay card/Apple Pay sandbox handoff.
---

# gcp-x402 native preview

Use the `gcp_x402` MCP tools for the entire journey. Do not orchestrate `npx` subprocesses after the native session starts.

If `v3_trading_catalog` is unavailable, explain that an installed skill cannot inject an MCP into an already-running coding-agent process. Ask the user to run this once in the same terminal, then continue in the Codex session it opens:

```bash
npx -y github:zwowo1997/gcp-x402 setup
npx -y github:zwowo1997/gcp-x402 codex
```

This launcher injects only the allowlisted gcp-x402 tools and uses private machine-level state across project directories. Never claim the existing process can gain tools dynamically.

## Start

If the service is locked, ask the user for the operator-provided beta password and pass it directly to `unlock_service`. Never save, echo, or put the password in a shell command.

Offer exactly two routes:

1. Base Sepolia testnet USDC — end-to-end temporary GCP provisioning.
2. MoonPay sandbox — hosted card/Apple Pay/KYC UX showcase; stops at the provider page.

Never combine the routes or treat MoonPay completion as deployment approval.

## Base Sepolia route

1. Call `wallet_info` and `v3_trading_catalog`.
2. Let the user choose 15, 30, or 60 minutes. Default to 15 minutes only if they ask for the cheapest/shortest demo.
3. Call `v3_trading_quote` with the duration and requested paper-strategy limits.
4. Show:
   - estimated GCP usage;
   - exact expected testnet-USDC charge;
   - authorization ceiling;
   - unused allowance, which is never transferred;
   - expiry and every planned GCP service.
5. If wallet funds are insufficient, ask the user to fund the displayed address with Base Sepolia USDC. Never request a private key.
6. Ask once for explicit approval of the exact `expectedChargeUsd`, duration, and paper-only stack. A generic `$5` approval is invalid.
7. Only after approval, call `v3_trading_deploy` once with the same duration, strategy, and exact approved amount.

The client preserves one request ID across uncertain outcomes. Never create a fresh request or invoke a legacy `trading-deploy` fallback. On success, report the dashboard, lease expiry, settled amount, unused allowance, and exact GCP resource/cost rows.

## MoonPay route

After the user chooses MoonPay, call `moonpay_showcase` with their intent and duration. It returns a clickable official `buy-sandbox.moonpay.com` URL and attempts to open it from the current MCP session.

If desktop launch is unavailable, present the returned URL directly in chat. Do not ask the user to run another terminal command. Stop after the hosted MoonPay page opens. Do not consume a payment result, invoke x402, provision GCP, create a trading dashboard, or trade.

MoonPay test assets are on Ethereum Sepolia and do not fund Base Sepolia.

## Safety

- Never collect card details, KYC data, seed phrases, or private keys.
- Every deployed strategy is paper-only; no Hyperliquid account or live/testnet exchange order is used.
- Require fresh exact-price approval before any paid tool.
- Never retry with a new request ID.
- Do not use V2 commands as a fallback.
