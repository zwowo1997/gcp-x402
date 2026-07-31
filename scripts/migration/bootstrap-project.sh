#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

required=(gcloud openssl)
for command_name in "${required[@]}"; do
  command -v "$command_name" >/dev/null || {
    echo "missing required command: $command_name" >&2
    exit 1
  }
done

: "${TARGET_PROJECT_ID:?set TARGET_PROJECT_ID}"
: "${BETA_PASSWORD_FILE:?set BETA_PASSWORD_FILE to a protected plaintext file outside the repo}"

TARGET_REGION="${TARGET_REGION:-asia-northeast1}"
TARGET_SPANNER_REGION="${TARGET_SPANNER_REGION:-us-central1}"
TARGET_FIRESTORE_LOCATION="${TARGET_FIRESTORE_LOCATION:-us-central1}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-gcp-x402}"
TASKS_QUEUE="${TASKS_QUEUE:-gcp-x402-cleanup}"
SPANNER_INSTANCE="${SPANNER_INSTANCE:-hyperliquid-test}"
SPANNER_DATABASE="${SPANNER_DATABASE:-hyperliquid-demo}"

if [[ ! -f "$BETA_PASSWORD_FILE" || ! -s "$BETA_PASSWORD_FILE" ]]; then
  echo "BETA_PASSWORD_FILE must exist and contain the private-beta password" >&2
  exit 1
fi

active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
if [[ -z "$active_account" ]]; then
  echo "no active gcloud account; run gcloud auth login" >&2
  exit 1
fi

billing_enabled="$(gcloud billing projects describe "$TARGET_PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || true)"
if [[ "$billing_enabled" != "True" ]]; then
  echo "project $TARGET_PROJECT_ID must have billing enabled before bootstrap" >&2
  exit 1
fi

echo "enabling required APIs in $TARGET_PROJECT_ID"
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  bigquery.googleapis.com secretmanager.googleapis.com firestore.googleapis.com \
  compute.googleapis.com storage.googleapis.com cloudtasks.googleapis.com \
  pubsub.googleapis.com spanner.googleapis.com iamcredentials.googleapis.com \
  firebase.googleapis.com firebasehosting.googleapis.com \
  --project="$TARGET_PROJECT_ID"

project_number="$(gcloud projects describe "$TARGET_PROJECT_ID" --format='value(projectNumber)')"

ensure_service_account() {
  local account_id="$1"
  local display_name="$2"
  local email="${account_id}@${TARGET_PROJECT_ID}.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$email" --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account_id" \
      --display-name="$display_name" \
      --project="$TARGET_PROJECT_ID"
  fi
}

grant_project_role() {
  local member="$1"
  local role="$2"
  gcloud projects add-iam-policy-binding "$TARGET_PROJECT_ID" \
    --member="$member" \
    --role="$role" \
    --condition=None \
    --quiet >/dev/null
}

ensure_service_account "gcp-x402-run" "gcp-x402 control plane"
ensure_service_account "gcp-x402-trading-runtime" "gcp-x402 paper trading runtime"
ensure_service_account "gcp-x402-pubsub-push" "gcp-x402 Pub/Sub authenticated push"

run_sa="gcp-x402-run@${TARGET_PROJECT_ID}.iam.gserviceaccount.com"
runtime_sa="gcp-x402-trading-runtime@${TARGET_PROJECT_ID}.iam.gserviceaccount.com"
push_sa="gcp-x402-pubsub-push@${TARGET_PROJECT_ID}.iam.gserviceaccount.com"

for role in \
  roles/bigquery.jobUser \
  roles/compute.instanceAdmin.v1 \
  roles/storage.admin \
  roles/datastore.user \
  roles/cloudtasks.enqueuer \
  roles/run.admin \
  roles/pubsub.admin \
  roles/spanner.admin \
  roles/artifactregistry.reader; do
  grant_project_role "serviceAccount:${run_sa}" "$role"
done

for role in roles/pubsub.publisher roles/spanner.databaseUser roles/artifactregistry.reader; do
  grant_project_role "serviceAccount:${runtime_sa}" "$role"
done

for target_sa in "$runtime_sa" "$push_sa"; do
  gcloud iam service-accounts add-iam-policy-binding "$target_sa" \
    --project="$TARGET_PROJECT_ID" \
    --member="serviceAccount:${run_sa}" \
    --role="roles/iam.serviceAccountUser" \
    --condition=None \
    --quiet >/dev/null
done

gcloud beta services identity create \
  --service=pubsub.googleapis.com \
  --project="$TARGET_PROJECT_ID" >/dev/null
gcloud beta services identity create \
  --service=cloudbuild.googleapis.com \
  --project="$TARGET_PROJECT_ID" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$push_sa" \
  --project="$TARGET_PROJECT_ID" \
  --member="serviceAccount:service-${project_number}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --condition=None \
  --quiet >/dev/null

# Cloud Build implementations differ by project age and organization policy.
# Grant image-push access to the managed service agent and to the default compute
# account used by newer projects.
for build_member in \
  "serviceAccount:service-${project_number}@gcp-sa-cloudbuild.iam.gserviceaccount.com" \
  "serviceAccount:${project_number}-compute@developer.gserviceaccount.com"; do
  grant_project_role "$build_member" "roles/artifactregistry.writer"
done

if ! gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" \
  --location="$TARGET_REGION" --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
    --repository-format=docker \
    --location="$TARGET_REGION" \
    --description="gcp-x402 runtime images" \
    --project="$TARGET_PROJECT_ID"
fi

if ! gcloud tasks queues describe "$TASKS_QUEUE" \
  --location="$TARGET_REGION" --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
  gcloud tasks queues create "$TASKS_QUEUE" \
    --location="$TARGET_REGION" \
    --project="$TARGET_PROJECT_ID"
fi

if ! gcloud firestore databases describe \
  --database='(default)' --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
  gcloud firestore databases create \
    --database='(default)' \
    --location="$TARGET_FIRESTORE_LOCATION" \
    --type=firestore-native \
    --project="$TARGET_PROJECT_ID"
fi

if ! gcloud spanner instances describe "$SPANNER_INSTANCE" \
  --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
  if [[ "${ALLOW_BILLABLE_BOOTSTRAP:-no}" != "yes" ]]; then
    echo "Spanner instance is absent. Review its recurring cost, then set ALLOW_BILLABLE_BOOTSTRAP=yes and rerun." >&2
    exit 2
  fi
  gcloud spanner instances create "$SPANNER_INSTANCE" \
    --config="regional-${TARGET_SPANNER_REGION}" \
    --description="Shared gcp-x402 paper trading data" \
    --processing-units=100 \
    --edition=STANDARD \
    --project="$TARGET_PROJECT_ID"
fi

if ! gcloud spanner databases describe "$SPANNER_DATABASE" \
  --instance="$SPANNER_INSTANCE" --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
  gcloud spanner databases create "$SPANNER_DATABASE" \
    --instance="$SPANNER_INSTANCE" \
    --ddl-file="$root/infrastructure/spanner-schema.sql" \
    --project="$TARGET_PROJECT_ID"
fi

ensure_random_secret() {
  local secret_name="$1"
  if ! gcloud secrets describe "$secret_name" --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
    openssl rand -base64 48 | gcloud secrets create "$secret_name" \
      --data-file=- \
      --replication-policy=automatic \
      --project="$TARGET_PROJECT_ID" >/dev/null
  fi
}

for secret_name in \
  gcp-x402-quote-secret \
  gcp-x402-resource-capability \
  gcp-x402-cleanup-token \
  gcp-x402-dashboard-token \
  gcp-x402-beta-session-secret; do
  ensure_random_secret "$secret_name"
done

if ! gcloud secrets describe gcp-x402-beta-password \
  --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create gcp-x402-beta-password \
    --data-file="$BETA_PASSWORD_FILE" \
    --replication-policy=automatic \
    --project="$TARGET_PROJECT_ID" >/dev/null
fi

for secret_name in \
  gcp-x402-quote-secret \
  gcp-x402-resource-capability \
  gcp-x402-cleanup-token \
  gcp-x402-dashboard-token \
  gcp-x402-beta-password \
  gcp-x402-beta-session-secret; do
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --project="$TARGET_PROJECT_ID" \
    --member="serviceAccount:${run_sa}" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None \
    --quiet >/dev/null
done

echo "bootstrap complete"
echo "project=$TARGET_PROJECT_ID"
echo "project_number=$project_number"
echo "region=$TARGET_REGION"
echo "spanner=${SPANNER_INSTANCE}/${SPANNER_DATABASE}"
echo "next: scripts/migration/deploy-service.sh"
