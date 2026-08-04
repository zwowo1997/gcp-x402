#!/usr/bin/env bash
# Minimal, isolated bootstrap for the free v3 simulator. No Spanner, Pub/Sub,
# Cloud Tasks, Firebase, Compute Engine, or tenant provisioning permissions.
set -euo pipefail

for command_name in gcloud openssl; do command -v "$command_name" >/dev/null || { echo "missing required command: $command_name" >&2; exit 1; }; done
: "${TARGET_PROJECT_ID:?set TARGET_PROJECT_ID}"
: "${BETA_PASSWORD_FILE:?set BETA_PASSWORD_FILE to a protected plaintext file outside the repo}"
[[ -s "$BETA_PASSWORD_FILE" ]] || { echo "BETA_PASSWORD_FILE must exist and be non-empty" >&2; exit 1; }

TARGET_REGION="${TARGET_REGION:-asia-northeast1}"
TARGET_FIRESTORE_LOCATION="${TARGET_FIRESTORE_LOCATION:-us-central1}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-gcp-x402}"
run_sa="gcp-x402-v3-preview-run@${TARGET_PROJECT_ID}.iam.gserviceaccount.com"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com --project="$TARGET_PROJECT_ID"
project_number="$(gcloud projects describe "$TARGET_PROJECT_ID" --format='value(projectNumber)')"

if ! gcloud iam service-accounts describe "$run_sa" --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create gcp-x402-v3-preview-run --display-name="gcp-x402 v3 simulator" --project="$TARGET_PROJECT_ID"
fi
for role in roles/datastore.user roles/artifactregistry.reader; do
  gcloud projects add-iam-policy-binding "$TARGET_PROJECT_ID" --member="serviceAccount:${run_sa}" --role="$role" --condition=None --quiet >/dev/null
done
for build_member in "serviceAccount:service-${project_number}@gcp-sa-cloudbuild.iam.gserviceaccount.com" "serviceAccount:${project_number}-compute@developer.gserviceaccount.com"; do
  gcloud projects add-iam-policy-binding "$TARGET_PROJECT_ID" --member="$build_member" --role=roles/artifactregistry.writer --condition=None --quiet >/dev/null
done

if ! gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" --location="$TARGET_REGION" --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" --repository-format=docker --location="$TARGET_REGION" --description="gcp-x402 preview images" --project="$TARGET_PROJECT_ID"
fi
if ! gcloud firestore databases describe --database='(default)' --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
  gcloud firestore databases create --database='(default)' --location="$TARGET_FIRESTORE_LOCATION" --type=firestore-native --project="$TARGET_PROJECT_ID"
fi
gcloud firestore fields ttls update deleteAt --collection-group=v3_simulations --database='(default)' --enable-ttl --project="$TARGET_PROJECT_ID" --quiet --async >/dev/null
gcloud firestore fields ttls update deleteAt --collection-group=v3_simulation_requests --database='(default)' --enable-ttl --project="$TARGET_PROJECT_ID" --quiet --async >/dev/null

ensure_random_secret() {
  local name="$1"
  if ! gcloud secrets describe "$name" --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
    openssl rand -base64 48 | gcloud secrets create "$name" --data-file=- --replication-policy=automatic --project="$TARGET_PROJECT_ID" >/dev/null
  fi
}
for name in gcp-x402-v3-preview-quote-secret gcp-x402-v3-preview-resource-capability gcp-x402-v3-preview-beta-session-secret; do ensure_random_secret "$name"; done
if ! gcloud secrets describe gcp-x402-v3-preview-beta-password --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create gcp-x402-v3-preview-beta-password --data-file="$BETA_PASSWORD_FILE" --replication-policy=automatic --project="$TARGET_PROJECT_ID" >/dev/null
fi
secret_names=(gcp-x402-v3-preview-quote-secret gcp-x402-v3-preview-resource-capability gcp-x402-v3-preview-beta-session-secret gcp-x402-v3-preview-beta-password)
if [[ -n "${MOONPAY_PUBLIC_KEY:-}" ]]; then
  [[ "$MOONPAY_PUBLIC_KEY" == pk_test_* ]] || { echo "V3 accepts only a MoonPay pk_test_ publishable key" >&2; exit 1; }
  : "${MOONPAY_SECRET_KEY_FILE:?set MOONPAY_SECRET_KEY_FILE when enabling MoonPay URL signing}"
  : "${MOONPAY_WEBHOOK_KEY_FILE:?set MOONPAY_WEBHOOK_KEY_FILE when enabling MoonPay}"
  [[ -s "$MOONPAY_SECRET_KEY_FILE" ]] || { echo "MOONPAY_SECRET_KEY_FILE must exist and be non-empty" >&2; exit 1; }
  [[ -s "$MOONPAY_WEBHOOK_KEY_FILE" ]] || { echo "MOONPAY_WEBHOOK_KEY_FILE must exist and be non-empty" >&2; exit 1; }
  [[ "$(tr -d '\r\n' < "$MOONPAY_SECRET_KEY_FILE")" == sk_test_* ]] || { echo "MOONPAY_SECRET_KEY_FILE must contain an sk_test_ key" >&2; exit 1; }
  if ! gcloud secrets describe gcp-x402-v3-preview-moonpay-signing --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create gcp-x402-v3-preview-moonpay-signing --data-file="$MOONPAY_SECRET_KEY_FILE" --replication-policy=automatic --project="$TARGET_PROJECT_ID" >/dev/null
  fi
  if ! gcloud secrets describe gcp-x402-v3-preview-moonpay-webhook --project="$TARGET_PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create gcp-x402-v3-preview-moonpay-webhook --data-file="$MOONPAY_WEBHOOK_KEY_FILE" --replication-policy=automatic --project="$TARGET_PROJECT_ID" >/dev/null
  fi
  secret_names+=(gcp-x402-v3-preview-moonpay-signing gcp-x402-v3-preview-moonpay-webhook)
fi
for name in "${secret_names[@]}"; do
  gcloud secrets add-iam-policy-binding "$name" --project="$TARGET_PROJECT_ID" --member="serviceAccount:${run_sa}" --role=roles/secretmanager.secretAccessor --condition=None --quiet >/dev/null
done
echo "v3 preview bootstrap complete: $TARGET_PROJECT_ID"
