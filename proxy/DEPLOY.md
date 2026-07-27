# Deploying the gcp-x402 proxy to Cloud Run

The proxy is a Next.js app that builds to a standalone server (`output: "standalone"`)
and ships as a container (`Dockerfile`). On Cloud Run it authenticates to BigQuery via
its **attached service account** — so there is **no `GCP_SERVICE_ACCOUNT_JSON` key** to
manage (the big win of running on GCP).

Project: **`gcp-x402`** · Region used below: **`us-central1`** (close to the
`bigquery-public-data` US multi-region).

## One-time setup

```bash
# 0) Authenticate (interactive) and select the project
gcloud auth login
gcloud config set project gcp-x402

# 1) Enable the APIs the deploy needs
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  bigquery.googleapis.com secretmanager.googleapis.com firestore.googleapis.com \
  compute.googleapis.com storage.googleapis.com cloudtasks.googleapis.com

# 2) Least-privilege runtime service account: can run BigQuery jobs, nothing else.
gcloud iam service-accounts create gcp-x402-run \
  --display-name="gcp-x402 Cloud Run runtime"
gcloud projects add-iam-policy-binding gcp-x402 \
  --member="serviceAccount:gcp-x402-run@gcp-x402.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"
# Demo provisioning permissions. Replace these broad demo roles with a custom
# role before production; the service never receives IAM or billing privileges.
gcloud projects add-iam-policy-binding gcp-x402 \
  --member="serviceAccount:gcp-x402-run@gcp-x402.iam.gserviceaccount.com" \
  --role="roles/compute.instanceAdmin.v1"
gcloud projects add-iam-policy-binding gcp-x402 \
  --member="serviceAccount:gcp-x402-run@gcp-x402.iam.gserviceaccount.com" \
  --role="roles/storage.admin"
gcloud projects add-iam-policy-binding gcp-x402 \
  --member="serviceAccount:gcp-x402-run@gcp-x402.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
gcloud projects add-iam-policy-binding gcp-x402 \
  --member="serviceAccount:gcp-x402-run@gcp-x402.iam.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer"

# Firestore must be initialized once in Native mode (Console or gcloud) and the
# cleanup queue must exist before provisioning is enabled.
gcloud tasks queues create gcp-x402-cleanup --location us-central1

# 3) Quote-signing secret in Secret Manager (instead of a plaintext env var)
printf '%s' "$(openssl rand -base64 48)" | \
  gcloud secrets create gcp-x402-quote-secret --data-file=-
gcloud secrets add-iam-policy-binding gcp-x402-quote-secret \
  --member="serviceAccount:gcp-x402-run@gcp-x402.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Create RESOURCE_CAPABILITY_SECRET, CLEANUP_TOKEN, DASHBOARD_TOKEN,
# BETA_ACCESS_PASSWORD, and BETA_SESSION_SECRET in
# Secret Manager using the same pattern, then grant the runtime service account
# roles/secretmanager.secretAccessor for each secret.
```

## Deploy (and redeploy)

```bash
# Sync the skill into the image so GET /skill and /architecture serve the current versions.
./scripts/sync-assets.sh

cd proxy
gcloud run deploy gcp-x402 \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account gcp-x402-run@gcp-x402.iam.gserviceaccount.com \
  --cpu 1 --memory 512Mi --timeout 120 --max-instances 1 \
  --set-secrets QUOTE_SECRET=gcp-x402-quote-secret:latest,RESOURCE_CAPABILITY_SECRET=gcp-x402-resource-capability:latest,CLEANUP_TOKEN=gcp-x402-cleanup-token:latest,DASHBOARD_TOKEN=gcp-x402-dashboard-token:latest,BETA_ACCESS_PASSWORD=gcp-x402-beta-password:latest,BETA_SESSION_SECRET=gcp-x402-beta-session-secret:latest \
  --set-env-vars '^|^X402_NETWORK=base-sepolia|TEST_MODE=true|PAY_TO_ADDRESS=0x90e4071A1b7b1fc9A5d0b7EA6bEB1174F847F079|FACILITATOR_URL=https://x402.org/facilitator|GCP_PROJECT_ID=gcp-x402|MAX_BYTES_PER_QUERY=1073741824|MAX_GCP_COST_PER_PROVISION_USD=5|MAX_OUTSTANDING_GCP_EXPOSURE_USD=5|MAX_RENTAL_MINUTES=60|CLOUD_TASKS_QUEUE=gcp-x402-cleanup|CLOUD_TASKS_LOCATION=us-central1|PUBLIC_BASE_URL=https://YOUR-CLOUD-RUN-URL'
```

> The `^|^` prefix tells gcloud to split env vars on `|` instead of `,`, so values
> containing commas are safe. `--source .` builds the `Dockerfile` via Cloud Build —
> no local Docker needed. The first run may prompt to create an Artifact Registry repo;
> accept it.

Get the URL:

```bash
gcloud run services describe gcp-x402 --region us-central1 --format='value(status.url)'
```

## After it's live

1. **Smoke test** (no payment — should be `402` with a price, proving BigQuery auth works
   via the attached SA):
   ```bash
   URL=$(gcloud run services describe gcp-x402 --region us-central1 --format='value(status.url)')
   curl -i -X POST "$URL/api/query" -H 'content-type: application/json' \
     -d '{"sql":"SELECT name FROM `bigquery-public-data.usa_names.usa_1910_2013` WHERE state=\"CA\" LIMIT 5"}'
   ```
2. **Point the client at it** — set the default `PROXY_URL` (in `src/config.ts`) and the
   docs/skill references to this URL, or map a custom domain:
   ```bash
   gcloud run domain-mappings create --service gcp-x402 --domain <your.domain> --region us-central1
   ```
3. **Decommission Vercel** once the Cloud Run URL is verified and clients are switched.

4. **Provisioning prerequisite:** replace `PUBLIC_BASE_URL` with the actual service
   URL from step 1 and redeploy before allowing any provisioning request. The service
   fails closed if automatic cleanup cannot be queued.

## Notes

- **Billing:** queries now bill to project `gcp-x402` (set as `GCP_PROJECT_ID`). Make sure
  that project has a billing account.
- **Mainnet:** flip `X402_NETWORK=base` and point `FACILITATOR_URL` at a mainnet
  facilitator when ready — just change the env vars and redeploy.
- **Scales to zero:** Cloud Run idles at $0 when there's no traffic.

## Tokyo paper-trading stack

This is a separate, **paper-only** feature. It deploys its data and strategy runtime
in `asia-northeast1` (Tokyo); it does not make an account or activity eligible for any
exchange where it is restricted. Check Hyperliquid's current terms and local rules
before ever adding a future execution adapter.

The MCP/proxy remains the payment and lifecycle control plane. For each paid 24-hour
stack it creates a Pub/Sub topic, a database in one shared 100-PU Tokyo Spanner
instance, and three private Cloud Run services (collector, writer, strategy). The
collector uses public data only; the strategy writes simulated orders only. The
operator's exposure reservation is capped by `MAX_OUTSTANDING_GCP_EXPOSURE_USD=5`.
When the final managed paper stack expires, fails, or is shut down, the service also
removes that managed shared Spanner instance. Do not point `TRADING_SPANNER_INSTANCE`
at an unrelated instance: only instances labelled `managed_by=gcp_x402` are removable.

```bash
# Run once in the operator project. These are deliberately broad demo-control-plane
# permissions; replace them with a reviewed custom role before a production launch.
gcloud services enable pubsub.googleapis.com spanner.googleapis.com
gcloud artifacts repositories create gcp-x402 --repository-format=docker --location=asia-northeast1
gcloud iam service-accounts create gcp-x402-trading-runtime --display-name="paper trading runtime"
gcloud iam service-accounts create gcp-x402-pubsub-push --display-name="Pub/Sub authenticated push"

gcloud projects add-iam-policy-binding YOUR_PROJECT \
  --member="serviceAccount:gcp-x402-trading-runtime@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
gcloud projects add-iam-policy-binding YOUR_PROJECT \
  --member="serviceAccount:gcp-x402-trading-runtime@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/spanner.databaseUser"
gcloud projects add-iam-policy-binding YOUR_PROJECT \
  --member="serviceAccount:gcp-x402-run@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding YOUR_PROJECT \
  --member="serviceAccount:gcp-x402-run@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/pubsub.admin"
gcloud projects add-iam-policy-binding YOUR_PROJECT \
  --member="serviceAccount:gcp-x402-run@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/spanner.admin"
gcloud iam service-accounts add-iam-policy-binding \
  gcp-x402-trading-runtime@YOUR_PROJECT.iam.gserviceaccount.com \
  --member="serviceAccount:gcp-x402-run@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
gcloud iam service-accounts add-iam-policy-binding \
  gcp-x402-pubsub-push@YOUR_PROJECT.iam.gserviceaccount.com \
  --member="serviceAccount:gcp-x402-run@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Pub/Sub needs this only to mint its authenticated Cloud Run push token.
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding \
  gcp-x402-pubsub-push@YOUR_PROJECT.iam.gserviceaccount.com \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# Build the immutable, paper-only runtime image.
gcloud tasks queues create gcp-x402-cleanup --location=asia-northeast1
gcloud builds submit trading-runtime \
  --tag asia-northeast1-docker.pkg.dev/YOUR_PROJECT/gcp-x402/hyperliquid-paper:paper-v1
```

Deploy a Tokyo control-plane revision (use the actual URL in `PUBLIC_BASE_URL` after
the first deploy), then set `TRADING_DASHBOARD_URL` to the Firebase Hosting URL:

```bash
cd proxy
gcloud run deploy gcp-x402-tokyo --source . --region asia-northeast1 --allow-unauthenticated \
  --service-account gcp-x402-run@YOUR_PROJECT.iam.gserviceaccount.com \
  --max-instances 1 \
  --set-secrets QUOTE_SECRET=gcp-x402-quote-secret:latest,RESOURCE_CAPABILITY_SECRET=gcp-x402-resource-capability:latest,CLEANUP_TOKEN=gcp-x402-cleanup-token:latest,DASHBOARD_TOKEN=gcp-x402-dashboard-token:latest,BETA_ACCESS_PASSWORD=gcp-x402-beta-password:latest,BETA_SESSION_SECRET=gcp-x402-beta-session-secret:latest \
  --set-env-vars '^|^X402_NETWORK=base-sepolia|TEST_MODE=true|PAY_TO_ADDRESS=YOUR_BASE_SEPOLIA_ADDRESS|GCP_PROJECT_ID=YOUR_PROJECT|CLOUD_TASKS_QUEUE=gcp-x402-cleanup|CLOUD_TASKS_LOCATION=asia-northeast1|TRADING_REGION=asia-northeast1|TRADING_SPANNER_INSTANCE=gcp-x402-trading|TRADING_RUNTIME_SERVICE_ACCOUNT=gcp-x402-trading-runtime@YOUR_PROJECT.iam.gserviceaccount.com|TRADING_PUBSUB_PUSH_SERVICE_ACCOUNT=gcp-x402-pubsub-push@YOUR_PROJECT.iam.gserviceaccount.com|TRADING_IMAGE=asia-northeast1-docker.pkg.dev/YOUR_PROJECT/gcp-x402/hyperliquid-paper:paper-v1|TRADING_DASHBOARD_URL=https://YOUR_FIREBASE_PROJECT.web.app|TRADING_LEASE_HOURS=24|MAX_GCP_COST_PER_PROVISION_USD=5|MAX_OUTSTANDING_GCP_EXPOSURE_USD=5|PUBLIC_BASE_URL=https://YOUR_TOKYO_CLOUD_RUN_URL'
```

Deploy the static dashboard after the Tokyo Cloud Run service exists. Firebase Hosting
rewrites `/api/*` to that fixed service, so a dashboard link never contains an editable
API origin. The per-stack capability remains only in the URL fragment:

```bash
firebase deploy --only hosting --config dashboard/firebase.json
```

The dashboard capability is placed in the URL fragment, so Firebase never receives it.
It can read its one stack and call only stop, resume, or shutdown for that stack.
