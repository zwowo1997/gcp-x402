# gcp-x402 — User Guide

Query Google BigQuery's public datasets or deploy a small temporary storage bucket from
your AI agent — **no Google Cloud account, no API keys**. You pay in test USDC and the
agent handles the GCP work for you.

This guide is for people *using* an agent (Claude Code, etc.), not deploying the service.

---

## 1. Install the skill

Just tell your agent, in plain English:

> **install the skill at https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app/skill**

That's it. The agent fetches the skill from that URL and drops it into its skills folder.
From then on, whenever you ask a question that public data can answer, it knows how to use
the tool.

<details>
<summary>Prefer to install it by hand?</summary>

Run this from the project where you want the skill (installs it just for that project):

```bash
mkdir -p .claude/skills/gcp-x402 && \
curl -fsSL https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app/skill \
  -o .claude/skills/gcp-x402/SKILL.md
```
</details>

---

## 2. Fund the wallet (one time)

The first time you run a query, the tool creates a small crypto **wallet** for the project
and needs a little **USDC on the Base network** to pay with.

Ask your agent:

> **what's my gcp-x402 wallet address?**

It'll show you an address. Send it some USDC on Base:

- **Testing (free):** get test USDC at **https://faucet.circle.com** → choose **Base Sepolia**
  → paste the address. A dollar or two is plenty (queries cost ~$0.002 each).
- **Real use:** send USDC on **Base** from any wallet/exchange.

> You only need USDC — no ETH for gas. Each project keeps its own wallet, so funds don't
> mix between projects.

---

## 3. Ask away

Now just ask normal questions. The agent writes the SQL, shows you the price, pays, and
gives you the answer. For example:

> *“What were the 10 most popular baby names in California, all-time? Use BigQuery.”*

> *“Using the public Hacker News dataset, what were the top 5 stories by score in 2015?”*

> *“From the NOAA weather data, what was the average temperature in Seattle in July 2020?”*

You can also ask it to **estimate the cost first** for anything that might be large:

> *“Estimate what that query would cost before running it.”*

To deploy a bucket, simply ask:

> *“Help me deploy a storage bucket without a GCP account.”*

The agent checks its generated wallet, explains the `$0.50` Base Sepolia USDC
test charge and one-hour expiry, then creates the private temporary bucket after
your approval. You never need GCP credentials.

---

## What it costs

Pricing is based on how much data the query scans (≈ $6.25 per terabyte), with a tiny
floor. In practice:

| Query | Typical cost |
| --- | --- |
| A focused query on a normal table | **$0.002** (the minimum) |
| Scanning ~1 GB | ~$0.012 |

The tool won't auto-pay more than **$1.00** for a single query unless you raise the limit,
and you're only ever charged for queries that succeed.

---

## Troubleshooting

**“host_not_allowed” / blocked when installing or querying.**
Your agent is running in a locked-down environment that only allows certain outbound
hosts. Ask whoever manages it to allow these:

- `gcp-x402-tokyo-837831206506.asia-northeast1.run.app` — installing the skill and running requests
- `github.com`, `codeload.github.com`, `registry.npmjs.org` — installing the tool itself
- `sepolia.base.org` (or `mainnet.base.org`) — checking your wallet balance

**“Insufficient funds” or a payment error.**
Your wallet is empty or low. Ask *“what's my gcp-x402 wallet address?”*, send it some USDC
(see step 2), and try again.

**It says it can only query public data.**
Correct — only Google's `bigquery-public-data` datasets are available, and read-only
(`SELECT`) queries. That's the whole catalog of public datasets: census, weather, crypto,
GitHub, Hacker News, Stack Overflow, and ~200 more.

---

## Power users: MCP instead of a skill

If your client supports MCP (Model Context Protocol), you can register the tool directly
instead of using the skill:

```bash
claude mcp add gcp-x402 \
  -- npx -y github:zwowo1997/gcp-x402
```

This gives the agent structured tools (`bigquery_query`, `bigquery_estimate`,
`wallet_info`, `list_public_datasets`). Same wallet, same per-query pricing.
