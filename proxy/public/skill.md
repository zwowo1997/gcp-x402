---
name: gcp-x402
description: >-
  Query allowlisted Google BigQuery public datasets or provision a tightly scoped
  demo GCP VM or Cloud Storage bucket through gcp-x402. Use when a user asks to
  analyze public data with BigQuery, inspect the available GCP provisioning
  catalog, or create, check, or delete a paid temporary GCP resource. Payments
  use USDC over x402 on Base Sepolia in the current test deployment.
---

# gcp-x402: paid BigQuery and demo GCP resources

Use the hosted service at `https://gcp-x402-837831206506.us-central1.run.app`.
It accepts USDC payments through x402 on **Base Sepolia** and runs the paid work
using the operator's GCP account. Never treat it as a general-purpose GCP API.

## Commands

Run the CLI with this environment variable so it reaches the current deployment:

```bash
PROXY_URL=https://gcp-x402-837831206506.us-central1.run.app \
  npx -y github:zwowo1997/gcp-x402 <command>
```

| Command | Purpose |
| --- | --- |
| `wallet` | Show the project wallet, Base Sepolia USDC balance, and funding instructions. |
| `estimate "<sql>"` | Price an allowlisted BigQuery query without paying or executing it. |
| `query "<sql>"` | Pay and run an allowlisted read-only BigQuery query. |
| `datasets` | List supported public-data datasets and pricing information. |
| `catalog` | List available temporary GCP resource profiles. |
| `provision <vm.small|storage.small>` | Pay for and create one temporary catalog resource. |
| `provision-status <job-id> <capability>` | Inspect a provisioned resource. |
| `provision-delete <job-id> <capability>` | Delete a provisioned resource early. |

The first CLI use generates a wallet in `./.gcp-x402/wallet.json`. Run `wallet`
before any paid operation. If it has insufficient funds, show the address and ask
the user to fund it with Base Sepolia USDC; do not retry payment repeatedly.

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
PROXY_URL=https://gcp-x402-837831206506.us-central1.run.app \
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

The service limits each resource's estimated GCP cost and atomically caps total
outstanding test exposure at `$5`. This is an application safety control, not a
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
PROXY_URL=https://gcp-x402-837831206506.us-central1.run.app \
  npx -y github:zwowo1997/gcp-x402 catalog

PROXY_URL=https://gcp-x402-837831206506.us-central1.run.app \
  npx -y github:zwowo1997/gcp-x402 provision storage.small
```

Do not attempt arbitrary VM shapes, regions, public IPs, bucket policies, object
uploads, or IAM changes: those are outside the demo catalog. Do not provision a
resource merely to test the API; a successful request consumes a payment and GCP
capacity.

## Payment guardrail

Set `MAX_PAYMENT_USD` to the maximum single operation the user approved. The
default is `$1.00`, which allows the present catalog but should not be raised
without explicit approval:

```bash
MAX_PAYMENT_USD=0.50 \
PROXY_URL=https://gcp-x402-837831206506.us-central1.run.app \
  npx -y github:zwowo1997/gcp-x402 provision storage.small
```
