---
name: gcp-x402
description: >-
  Query allowlisted Google BigQuery public datasets, deploy a tightly scoped
  temporary GCP VM or Cloud Storage bucket, or create a paper-only Hyperliquid
  BTC perpetual trading infrastructure through gcp-x402, without the user having
  a GCP account. Use when a user asks to analyze public data, says things like
  "deploy a storage bucket without GCP", asks to inspect, create, check, or delete
  a paid demo GCP resource, or asks to set up automated/paper trading infrastructure
  on GCP and pay stablecoins. Payments use USDC over x402 on Base Sepolia.
---

# gcp-x402: paid BigQuery and demo GCP resources

Use the hosted service at `https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app`.
It accepts USDC payments through x402 on **Base Sepolia** and runs the paid work
using the operator's GCP account. Never treat it as a general-purpose GCP API.

## Commands

Run the CLI directly; its default is the hosted service:

```bash
npx -y github:zwowo1997/gcp-x402 <command>
```

| Command | Purpose |
| --- | --- |
| `unlock` | Prompt for the private-beta password and save an eight-hour signed session locally. |
| `wallet` | Show the project wallet, Base Sepolia USDC balance, and funding instructions. |
| `estimate "<sql>"` | Price an allowlisted BigQuery query without paying or executing it. |
| `query "<sql>"` | Pay and run an allowlisted read-only BigQuery query. |
| `datasets` | List supported public-data datasets and pricing information. |
| `catalog` | List available temporary GCP resource profiles. |
| `provision <vm.small|storage.small>` | Pay for and create one temporary catalog resource. |
| `provision-status <job-id> <capability>` | Inspect a provisioned resource. |
| `provision-delete <job-id> <capability>` | Delete a provisioned resource early. |
| `trading-catalog` | List the 24-hour Tokyo Hyperliquid paper-trading profile. |
| `trading-deploy` | Deploy once, or return a recent matching receipt without paying again. |
| `trading-deploy --new` | Intentionally create an additional paid stack; requires a fresh explicit `$5` approval. |
| `trading-status <stack-id> <capability>` | Inspect a paper stack and lifecycle events. |
| `trading-control <stack-id> <capability> <stop|resume|shutdown>` | Control a paper stack. |
| `trading-receipts` | List locally saved successful deployments without printing capabilities. |

Before any service command, determine the agent's absolute working directory. Ask the
user to unlock from that exact directory, rendering the real path and quoting it safely:

```bash
cd '<absolute agent working directory>'
npx -y github:zwowo1997/gcp-x402 unlock
```

Never give a bare `unlock` command without the `cd` line. The wallet and signed beta
session are project-local, so unlocking from another terminal directory creates state
the agent cannot use. After the user reports success, verify that
`<absolute agent working directory>/.gcp-x402/beta-session.json` exists before calling
the catalog. If it is absent, repeat the same directory-specific command. Never ask the
user to place the password in a command argument, environment variable, source file,
chat, or agent log. The plaintext password is not persisted; only an eight-hour signed
session is stored with restricted permissions.

The first CLI use generates a wallet in `./.gcp-x402/wallet.json`. Run `wallet`
before any paid operation. If it has insufficient funds, show the address and ask
the user to fund it with Base Sepolia USDC; do not retry payment repeatedly.

## Plain-English storage request

For a request such as **"Help me deploy a storage bucket without a GCP account"**:

1. Confirm the directory-specific `unlock` completed and its session file exists, then run `wallet` and `catalog` yourself. Do not ask the user for GCP credentials.
2. Explain that `storage.small` is a private, temporary bucket in `us-central1`,
   costs at most `$0.50` USDC on Base Sepolia, and is deleted within 60 minutes.
3. If the generated wallet lacks funds, show its address and the Base Sepolia USDC
   funding instruction. Resume after the user confirms it is funded.
4. Ask for confirmation to spend up to `$0.50`; if the user's request explicitly
   includes that approval, proceed.
5. Run `MAX_PAYMENT_USD=0.50 npx -y github:zwowo1997/gcp-x402 provision storage.small`.
6. Keep the returned `jobId` and `capability` private. Give the user the expiry and
   offer to delete the bucket early.

## BigQuery workflow

Use only read-only Standard SQL against fully-qualified
``bigquery-public-data.<dataset>.<table>`` tables. Do not use DML, DDL,
non-public tables, or `SELECT *` on broad datasets.

1. Draft a minimal-column query with filters.
2. Run `estimate` before queries that may be material in size.
3. State the quoted price and ask before a material charge.
4. Run `query` only after that approval.

`LIMIT` limits returned rows, not bytes scanned. Select fewer columns and filter
partitioned tables to reduce cost.

Example:

```bash
npx -y github:zwowo1997/gcp-x402 estimate \
  'SELECT name, SUM(number) AS total
   FROM `bigquery-public-data.usa_names.usa_1910_2013`
   WHERE state = "CA"
   GROUP BY name ORDER BY total DESC LIMIT 10'
```

## Temporary GCP provisioning workflow

Start with `catalog`. The current test catalog is deliberately small:

- `vm.small`: a small Compute Engine VM in `us-central1`, automatically deleted
  no later than 60 minutes after creation; payment ceiling `$1.00`.
- `storage.small`: a private regional Cloud Storage bucket in `us-central1`,
  automatically deleted no later than 60 minutes after creation; payment ceiling
  `$0.50`.

The service limits each operation's estimated GCP cost to its catalog ceiling (never
above `$5`) and atomically caps total outstanding test exposure at `$20`. This is an
application safety control, not a
GCP billing-account hard limit. The payment scheme currently charges the stated
catalog ceiling; do not describe it as a refundable deposit.

Before provisioning:

1. Show the `catalog` result and state the specific payment ceiling and expiry.
2. Ask the user for approval to pay and create the resource.
3. Confirm the wallet has enough Base Sepolia USDC.
4. Run `provision` once. Do not retry after an ambiguous failure.
5. Save the returned `jobId` and `capability` together. The capability is a
   secret bearer token required for status and deletion; never expose it in chat,
   commits, or logs.
6. Use `provision-status` to inspect it, or `provision-delete` when the user is
   done. Automatic cleanup is still scheduled at expiry.

Example:

```bash
npx -y github:zwowo1997/gcp-x402 catalog

npx -y github:zwowo1997/gcp-x402 provision storage.small
```

Do not attempt arbitrary VM shapes, regions, public IPs, bucket policies, object
uploads, or IAM changes: those are outside the demo catalog. Do not provision a
resource merely to test the API; a successful request consumes a payment and GCP
capacity.

## Hyperliquid paper-trading infrastructure workflow

Use this only for requests such as: **"Set up a full-stack Hyperliquid BTC perpetual
hedging strategy on GCP without a cloud account and pay stablecoin."** Start with
`trading-catalog`; it is a distinct profile, not a general-purpose exchange deployment.

The current release creates a 24-hour stack in Tokyo (`asia-northeast1`): public
Hyperliquid BTC market feed → a dedicated Pub/Sub path → renter-isolated rows in an
operator-owned shared Spanner database → private Cloud Run writer and EMA strategy
services → a Firebase-hosted control dashboard. It is
strictly paper-only: do not promise testnet/mainnet orders, request a Hyperliquid
account, request a private key, or suggest that the GCP region changes any exchange
eligibility restriction.

Before deploying:

1. Confirm the directory-specific `unlock` completed and its session file exists, then run `wallet` and `trading-catalog`.
2. State the maximum one-time payment (`$5.00` USDC on Base Sepolia), 24-hour expiry,
   Tokyo region, and simulated-only execution.
3. Ask for explicit approval to spend up to `$5.00`, unless the user already gave it.
4. Set the client cap and start one deployment. Never use `--new` for the user's first
   stack or to recover an ambiguous terminal handoff:

   ```bash
   MAX_PAYMENT_USD=5.00 npx -y github:zwowo1997/gcp-x402 trading-deploy
   ```

5. Treat any returned receipt as definitive success. Keep the returned `stackId` and
   `capability` private. Give the returned dashboard
   URL to the user; it contains the private capability in its fragment.
   The client also saves a local receipt under `.gcp-x402/trading-receipts.json`; if
   the terminal loses the response, recover it with `trading-receipt <stackId>`.
   If the command output is lost or appears to hang, do not start a new intent. Run
   `trading-receipts` first. If a receipt exists, use it and do not call deploy again.
   Otherwise invoke ordinary `trading-deploy` at most once to resume the in-flight key;
   it returns a recent matching receipt instead of charging again. Never use `--new`
   during recovery. Use `--new` only when the user explicitly requests a separate
   additional stack and freshly approves another payment up to `$5`.
6. Immediately after successful deployment, show a **GCP services and payment visibility**
   list in chat. Read the returned `costBreakdown`; for every item print its Google Cloud
   service, component, exact resource name, region, dedicated/shared scope, and
   `estimated24hUsd`. Then print `costSummary.x402PaymentUsd`,
   `costSummary.estimatedGcpUsageUsd`, and `costSummary.serviceAndRiskBufferUsd`.
   Label these as illustrative 24-hour allocations, not separate micropayments, a GCP
   invoice, or refundable amounts. Do not invent estimates when the response provides them.
7. Use `trading-status` for status. Use `trading-control ... stop` to pause Pub/Sub
   consumers, `resume` to restart them before expiry, or `shutdown` to delete the
   dedicated topic and Cloud Run services plus only that renter's shared-database rows early.

Do not run a paper deployment merely as a connectivity check. It creates billable GCP
resources and consumes a testnet payment. The operator caps each deployment at `$5`
and total outstanding testing exposure at `$20`; this is not a substitute for a GCP
billing budget.

## Payment guardrail

Set `MAX_PAYMENT_USD` to the maximum single operation the user approved. The
default is `$1.00`, which allows the present catalog but should not be raised
without explicit approval:

```bash
MAX_PAYMENT_USD=0.50 \
  npx -y github:zwowo1997/gcp-x402 provision storage.small
```
