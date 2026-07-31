# gcp-x402 migration runbook for an AI coding agent

This runbook creates an independent replica of gcp-x402 in another Google Cloud
project. The target reader is an AI coding agent operating a terminal with a human
available for authentication, billing approval, the private-beta password, and final
cutover approval.

The preferred migration is a **fresh control plane**: copy source code and
configuration, but do not copy Firestore stack records, Spanner tenant rows, user
wallets, capabilities, receipts, or signing secrets. Existing paid resources continue
to belong to the source deployment until they expire or are shut down there.

## Non-negotiable safety rules

1. Never print, commit, or place secret values in shell history.
2. Never copy `.gcp-x402/wallet.json`, `beta-session.json`, deployment receipts, or
   private capabilities into the repository or target project.
3. Do not reuse quote, session, cleanup, or capability signing secrets. Generate new
   values so the source deployment cannot authorize actions in the replica.
4. Keep `X402_NETWORK=base-sepolia`, `TEST_MODE=true`, and paper-only trading during
   migration.
5. Do not run a paid deployment merely as a health check. The included verifier stops
   at the expected HTTP `402` payment challenge.
6. Do not create Spanner until the human confirms the recurring cost. The bootstrap
   script requires `ALLOW_BILLABLE_BOOTSTRAP=yes`.
7. Do not redirect users until the verifier passes and the human approves cutover.
8. Use explicit project IDs on every `gcloud` command. Do not rely on whichever project
   happens to be active globally.

## What is and is not in Git

The repository contains the MCP/CLI client, Next.js control plane, paper-only trading
runtime, Firebase dashboard, hosted skill, Dockerfiles, tests, schema, and migration
scripts.

The repository does not contain:

- billing-account linkage;
- enabled APIs and IAM policy state;
- Secret Manager values;
- Firestore documents;
- Spanner instance capacity or tenant data;
- Artifact Registry images;
- Cloud Run revisions;
- Cloud Tasks;
- Firebase project/site state;
- Cloud Logging history;
- user wallets, beta sessions, receipts, or capabilities.

## Target architecture

The migration kit creates or configures:

- one public Cloud Run control-plane service in `asia-northeast1`;
- one Artifact Registry Docker repository in Tokyo;
- one shared Spanner instance in `us-central1`, using 100 processing units and
  Standard edition unless the operator changes the script;
- one `hyperliquid-demo` database with tenant-leading primary keys;
- one Firestore Native `(default)` database;
- one Tokyo Cloud Tasks cleanup queue;
- three service accounts;
- six Secret Manager secrets;
- one Firebase Hosting site that rewrites `/api/**` to Cloud Run;
- immutable proxy and paper-runtime images tagged with the Git commit.

Paid user deployments later create three dedicated Cloud Run services, one Pub/Sub
topic, two subscriptions, and isolated Spanner rows. Their lease is one hour.

## Phase 0: human checkpoints

Ask the human for:

- target GCP project ID;
- confirmation that billing is linked;
- globally unique Firebase Hosting site ID;
- Base Sepolia receiving wallet address;
- private-beta password delivered through a local file, not chat or a command argument;
- acknowledgement of the target Spanner recurring cost;
- confirmation that a fresh deployment is acceptable.

If continuity of existing users or live stacks is requested, stop. That is a different,
high-risk migration requiring coordinated secret and data transfer. Do not improvise it.

## Phase 1: clone and pin the source

```bash
gh repo clone zwowo1997/gcp-x402
cd gcp-x402
git fetch origin
git switch --detach origin/master
git rev-parse HEAD
npm ci
(cd proxy && npm ci)
npm test
npm run typecheck
(cd proxy && npm run typecheck)
```

Record the full commit SHA in the migration report. Do not deploy an uncommitted
working tree.

Create a read-only inventory of the source project:

```bash
export SOURCE_PROJECT_ID="source-project-id"
export MIGRATION_INVENTORY_FILE="/private/tmp/gcp-x402-source-inventory.json"
scripts/migration/inventory-source.sh
jq '.' "$MIGRATION_INVENTORY_FILE"
```

The inventory contains project/resource metadata and Secret Manager names only. It
does not read secret versions, Firestore documents, Spanner rows, wallet files,
capabilities, or user receipts.

## Phase 2: authenticate tools

Required local tools:

- `gcloud`
- `gh`
- Node.js 22 and `npm`/`npx`
- `jq`
- `curl`
- `openssl`
- Firebase CLI through `npx firebase-tools`

Authenticate interactively:

```bash
gcloud auth login
gcloud auth application-default login
npx -y firebase-tools login
```

Confirm the intended identities:

```bash
gcloud auth list
npx -y firebase-tools login:list
```

Do not use downloaded service-account keys for Cloud Run. The deployed service uses an
attached service account and Application Default Credentials.

## Phase 3: create migration configuration

Copy the template outside the repository:

```bash
cp migration/config.example.env /private/tmp/gcp-x402-target.env
chmod 600 /private/tmp/gcp-x402-target.env
```

Create the beta-password file outside the repository:

```bash
umask 077
read -s -p "Private beta password: " beta_password
printf '%s' "$beta_password" > /private/tmp/gcp-x402-beta-password.txt
unset beta_password
```

Edit `/private/tmp/gcp-x402-target.env`, including:

```bash
export TARGET_PROJECT_ID="new-project-id"
export FIREBASE_SITE_ID="globally-unique-site-id"
export PAY_TO_ADDRESS="0x..."
export BETA_PASSWORD_FILE="/private/tmp/gcp-x402-beta-password.txt"
export ALLOW_BILLABLE_BOOTSTRAP="yes"
```

Load it and confirm only non-secret values:

```bash
source /private/tmp/gcp-x402-target.env
printf 'project=%s region=%s firebase=%s\n' \
  "$TARGET_PROJECT_ID" "$TARGET_REGION" "$FIREBASE_SITE_ID"
```

Never print the beta-password file.

## Phase 4: bootstrap the target project

Run:

```bash
source /private/tmp/gcp-x402-target.env
scripts/migration/bootstrap-project.sh
```

The script is idempotent. It:

1. verifies active gcloud authentication and billing;
2. enables required APIs;
3. creates service accounts;
4. applies the demo IAM roles documented below;
5. creates Artifact Registry and the cleanup queue;
6. creates Firestore if absent;
7. pauses before creating Spanner unless billable bootstrap was acknowledged;
8. creates the shared database and schema;
9. generates fresh signing/control secrets;
10. creates the beta-password secret from the protected file;
11. grants the runtime service account access to those secrets.

The control-plane account receives broad demo roles:

- `roles/bigquery.jobUser`
- `roles/compute.instanceAdmin.v1`
- `roles/storage.admin`
- `roles/datastore.user`
- `roles/cloudtasks.enqueuer`
- `roles/run.admin`
- `roles/pubsub.admin`
- `roles/spanner.admin`
- `roles/artifactregistry.reader`

The trading-runtime account receives:

- `roles/pubsub.publisher`
- `roles/spanner.databaseUser`
- `roles/artifactregistry.reader`

These roles reproduce the test service. Before a public or mainnet release, replace the
broad control-plane roles with a reviewed custom role.

After bootstrap, verify:

```bash
gcloud iam service-accounts list --project="$TARGET_PROJECT_ID"
gcloud secrets list --project="$TARGET_PROJECT_ID"
gcloud tasks queues describe "$TASKS_QUEUE" \
  --location="$TARGET_REGION" --project="$TARGET_PROJECT_ID"
gcloud spanner instances describe "$SPANNER_INSTANCE" \
  --project="$TARGET_PROJECT_ID"
gcloud spanner databases ddl describe "$SPANNER_DATABASE" \
  --instance="$SPANNER_INSTANCE" --project="$TARGET_PROJECT_ID"
```

Do not read secret values merely to inspect them.

## Phase 5: deploy

Run:

```bash
source /private/tmp/gcp-x402-target.env
scripts/migration/deploy-service.sh
```

The script:

1. validates target configuration and secret existence;
2. synchronizes the canonical hosted skill into the proxy image;
3. builds immutable paper-runtime and proxy images;
4. deploys Cloud Run with attached service account, Secret Manager bindings, Tokyo
   region, one-hour leases, `$5` per-operation ceiling and `$20` total exposure cap;
5. discovers the real Cloud Run URL and replaces the temporary cleanup callback URL;
6. enables Firebase on the project when possible;
7. creates the Hosting site when absent;
8. generates a temporary Firebase rewrite config;
9. deploys the dashboard;
10. removes the generated config automatically.

Record:

- Cloud Build IDs;
- image digests;
- Cloud Run revision;
- service URL;
- hosted skill URL;
- Firebase dashboard URL.

If Firebase activation requires accepting terms or selecting an analytics location,
pause and ask the human to complete that console step. Then rerun the deployment script;
it is safe to rerun.

## Phase 6: verify without spending

Run:

```bash
source /private/tmp/gcp-x402-target.env
scripts/migration/verify-service.sh
```

The verifier:

- downloads the hosted skill;
- confirms one-hour wording, duplicate-payment recovery and cost visibility;
- creates a short-lived beta session without displaying the password;
- checks the trading catalog;
- checks the exact seven-resource estimate;
- sends an unpaid deployment request and requires HTTP `402`;
- confirms the challenge requests exactly `$5` and says `1-hour`;
- tests Firebase’s `/api/**` rewrite;
- confirms Cloud Tasks is `RUNNING`;
- confirms Spanner is `READY`;
- performs no payment and creates no user resources.

Any verifier failure blocks cutover.

Also check the latest revision for errors:

```bash
revision="$(gcloud run services describe "$SERVICE_NAME" \
  --region="$TARGET_REGION" \
  --project="$TARGET_PROJECT_ID" \
  --format='value(status.latestReadyRevisionName)')"

gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND
   resource.labels.service_name=\"$SERVICE_NAME\" AND
   resource.labels.revision_name=\"$revision\" AND severity>=ERROR" \
  --project="$TARGET_PROJECT_ID" \
  --freshness=30m \
  --limit=20
```

The expected result is no entries.

## Phase 7: configure external agents

The GitHub client’s built-in default points to the original operator deployment.
Every agent using the replica must receive:

```bash
export PROXY_URL="https://the-new-cloud-run-service-url"
```

Set that variable in the MCP server configuration as well as direct CLI invocations.

Install the replica’s dynamically rendered skill:

```text
https://the-new-cloud-run-service-url/skill
```

The hosted skill route rewrites the canonical service URL to the replica’s own origin.

User prompt:

```text
Install the skill at <new-service-url>/skill, then help me deploy a paper-only
Hyperliquid BTC hedging infrastructure on GCP in Tokyo without a GCP account.
Show the dashboard and exact resource-cost allocation.
```

The agent must unlock from its exact project directory and must ask before the `$5`
testnet payment.

## Phase 8: optional single paid acceptance test

Only perform this after explicit human approval. It consumes `$5` Base Sepolia USDC and
creates billable GCP resources.

Acceptance criteria:

1. one stack is created;
2. expiry is approximately one hour after creation;
3. three dedicated Cloud Run services become ready;
4. Pub/Sub has one topic and two subscriptions;
5. Spanner receives only that tenant’s rows;
6. dashboard receives live BTC data and simulated orders;
7. stop and resume work;
8. automatic cleanup removes all dedicated resources and tenant rows;
9. Firestore status becomes `expired`;
10. exposure capacity returns to zero.

Never issue a second deployment to recover a lost terminal response. Inspect
`trading-receipts` and resume the existing idempotent request.

## Data migration policy

For the recommended fresh migration, do not copy operational data.

If historical analytics are needed, export them to an archive separately after removing
capabilities and wallet-related fields. Do not import them into the target operational
Firestore collections.

If Spanner history is needed for reporting, export tenant data to a read-only analytics
destination. Do not import active tenant rows into the new shared runtime database.

Secret continuity is explicitly unsupported by the default migration. Reusing
`BETA_SESSION_SECRET`, `RESOURCE_CAPABILITY_SECRET`, `QUOTE_SECRET`, or
`CLEANUP_TOKEN` would allow source-issued tokens or callbacks to affect the target.

## Cutover

Before cutover, present the human with:

- source commit SHA;
- target project and project number;
- target Cloud Run revision and image digests;
- service, skill, and dashboard URLs;
- verifier output;
- active paid-stack count in source and target;
- rollback command.

Cutover means distributing the new skill URL and setting `PROXY_URL` in external MCP
configurations. There is no need to delete the source deployment immediately.

Keep both control planes isolated. Never point source cleanup tasks at the target URL or
vice versa.

## Rollback

Cloud Run rollback:

```bash
gcloud run services update-traffic "$SERVICE_NAME" \
  --region="$TARGET_REGION" \
  --project="$TARGET_PROJECT_ID" \
  --to-revisions="<previous-ready-revision>=100"
```

Firebase rollback should use the previous Hosting release from the Firebase console or
CLI release history.

If the replica is not yet serving users, the safest rollback is to stop distribution of
its skill URL, leave source production unchanged, and investigate without deleting data.

Do not delete Spanner, Firestore, secrets, or the target project during incident
response.

## Decommissioning the source

Only after all source stacks are terminal and the human approves:

1. verify no source Cloud Run services with names `hl-feed-*`, `hl-writer-*`, or
   `hl-paper-*` remain;
2. verify no source `hl-market-*`, `hl-persist-*`, or `hl-strategy-*` Pub/Sub resources
   remain;
3. export any required audit records;
4. disable new source unlocks;
5. retain source secrets and logs for the agreed audit period;
6. remove source infrastructure in a separately reviewed operation.

Migration does not authorize source decommissioning.

## Required final report from the AI agent

Return a concise report containing:

```text
Source commit:
Target project / project number:
Cloud Run revision:
Proxy image digest:
Trading-runtime image digest:
Service URL:
Skill URL:
Dashboard URL:
Firestore state:
Spanner state:
Cleanup queue state:
Verifier result:
Paid acceptance test: not run | approved and passed
Known warnings:
Rollback revision:
```

Do not include passwords, secret values, wallet private keys, session tokens,
capabilities, or full dashboard URLs containing capability fragments.
