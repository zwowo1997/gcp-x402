#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

for command_name in gcloud git jq npx; do
  command -v "$command_name" >/dev/null || {
    echo "missing required command: $command_name" >&2
    exit 1
  }
done

: "${TARGET_PROJECT_ID:?set TARGET_PROJECT_ID}"
: "${FIREBASE_SITE_ID:?set FIREBASE_SITE_ID to a globally unique site ID}"
: "${PAY_TO_ADDRESS:?set PAY_TO_ADDRESS to a Base Sepolia receiving address}"

if [[ ! "$PAY_TO_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "PAY_TO_ADDRESS must be a 20-byte EVM address" >&2
  exit 1
fi

TARGET_REGION="${TARGET_REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-gcp-x402-tokyo}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-gcp-x402}"
TASKS_QUEUE="${TASKS_QUEUE:-gcp-x402-cleanup}"
SPANNER_INSTANCE="${SPANNER_INSTANCE:-hyperliquid-test}"
SPANNER_DATABASE="${SPANNER_DATABASE:-hyperliquid-demo}"
TRADING_LEASE_HOURS="${TRADING_LEASE_HOURS:-1}"
MAX_GCP_COST_PER_PROVISION_USD="${MAX_GCP_COST_PER_PROVISION_USD:-5}"
MAX_OUTSTANDING_GCP_EXPOSURE_USD="${MAX_OUTSTANDING_GCP_EXPOSURE_USD:-20}"
MAX_RENTAL_MINUTES="${MAX_RENTAL_MINUTES:-60}"
V3_REAL_SETTLEMENT_ENABLED="${V3_REAL_SETTLEMENT_ENABLED:-false}"
V3_TESTNET_DEPLOY_ENABLED="${V3_TESTNET_DEPLOY_ENABLED:-false}"

if [[ "$V3_REAL_SETTLEMENT_ENABLED" != "false" ]]; then
  echo "v3 real settlement is not implemented in this beta release; set V3_REAL_SETTLEMENT_ENABLED=false" >&2
  exit 1
fi
[[ "$V3_TESTNET_DEPLOY_ENABLED" == "true" || "$V3_TESTNET_DEPLOY_ENABLED" == "false" ]] || { echo "V3_TESTNET_DEPLOY_ENABLED must be true or false" >&2; exit 1; }

if [[ "$TRADING_LEASE_HOURS" != "1" ]]; then
  echo "migration kit expects TRADING_LEASE_HOURS=1 for the current test release" >&2
  exit 1
fi

for secret_name in \
  gcp-x402-quote-secret \
  gcp-x402-resource-capability \
  gcp-x402-cleanup-token \
  gcp-x402-dashboard-token \
  gcp-x402-beta-password \
  gcp-x402-beta-session-secret; do
  gcloud secrets describe "$secret_name" \
    --project="$TARGET_PROJECT_ID" >/dev/null
done

commit_id="$(git -C "$root" rev-parse --short=12 HEAD)"
registry="${TARGET_REGION}-docker.pkg.dev/${TARGET_PROJECT_ID}/${ARTIFACT_REPOSITORY}"
runtime_image="${registry}/hyperliquid-paper:${commit_id}"
proxy_image="${registry}/proxy:${commit_id}"

"$root/scripts/sync-assets.sh"

gcloud builds submit "$root/trading-runtime" \
  --tag="$runtime_image" \
  --project="$TARGET_PROJECT_ID"
gcloud builds submit "$root/proxy" \
  --tag="$proxy_image" \
  --project="$TARGET_PROJECT_ID"

run_sa="gcp-x402-run@${TARGET_PROJECT_ID}.iam.gserviceaccount.com"
runtime_sa="gcp-x402-trading-runtime@${TARGET_PROJECT_ID}.iam.gserviceaccount.com"
push_sa="gcp-x402-pubsub-push@${TARGET_PROJECT_ID}.iam.gserviceaccount.com"
dashboard_url="https://${FIREBASE_SITE_ID}.web.app"

# The first revision uses a non-routable placeholder only long enough to discover
# Cloud Run's assigned URL. No paid requests should be accepted during migration.
gcloud run deploy "$SERVICE_NAME" \
  --image="$proxy_image" \
  --region="$TARGET_REGION" \
  --project="$TARGET_PROJECT_ID" \
  --allow-unauthenticated \
  --service-account="$run_sa" \
  --cpu=1 \
  --memory=512Mi \
  --timeout=15m \
  --max-instances=1 \
  --set-secrets="QUOTE_SECRET=gcp-x402-quote-secret:latest,RESOURCE_CAPABILITY_SECRET=gcp-x402-resource-capability:latest,CLEANUP_TOKEN=gcp-x402-cleanup-token:latest,DASHBOARD_TOKEN=gcp-x402-dashboard-token:latest,BETA_ACCESS_PASSWORD=gcp-x402-beta-password:latest,BETA_SESSION_SECRET=gcp-x402-beta-session-secret:latest" \
  --set-env-vars="^|^X402_NETWORK=base-sepolia|TEST_MODE=true|V3_REAL_SETTLEMENT_ENABLED=false|V3_TESTNET_DEPLOY_ENABLED=${V3_TESTNET_DEPLOY_ENABLED}|PAY_TO_ADDRESS=${PAY_TO_ADDRESS}|GCP_PROJECT_ID=${TARGET_PROJECT_ID}|CLOUD_TASKS_QUEUE=${TASKS_QUEUE}|CLOUD_TASKS_LOCATION=${TARGET_REGION}|TRADING_REGION=${TARGET_REGION}|TRADING_SPANNER_INSTANCE=${SPANNER_INSTANCE}|TRADING_SPANNER_DATABASE=${SPANNER_DATABASE}|TRADING_PAYMENT_TIMEOUT_SECONDS=600|TRADING_RUNTIME_SERVICE_ACCOUNT=${runtime_sa}|TRADING_PUBSUB_PUSH_SERVICE_ACCOUNT=${push_sa}|TRADING_IMAGE=${runtime_image}|TRADING_DASHBOARD_URL=${dashboard_url}|TRADING_LEASE_HOURS=${TRADING_LEASE_HOURS}|MAX_GCP_COST_PER_PROVISION_USD=${MAX_GCP_COST_PER_PROVISION_USD}|MAX_OUTSTANDING_GCP_EXPOSURE_USD=${MAX_OUTSTANDING_GCP_EXPOSURE_USD}|MAX_RENTAL_MINUTES=${MAX_RENTAL_MINUTES}|PUBLIC_BASE_URL=https://migration.invalid"

service_url="$(gcloud run services describe "$SERVICE_NAME" \
  --region="$TARGET_REGION" \
  --project="$TARGET_PROJECT_ID" \
  --format='value(status.url)')"

gcloud run services update "$SERVICE_NAME" \
  --region="$TARGET_REGION" \
  --project="$TARGET_PROJECT_ID" \
  --update-env-vars="PUBLIC_BASE_URL=${service_url}" >/dev/null

# Firebase CLI authentication is intentionally separate from gcloud auth.
# The operator must run `npx firebase-tools login` before this step if needed.
npx -y firebase-tools projects:addfirebase "$TARGET_PROJECT_ID" \
  --non-interactive >/dev/null 2>&1 || true

if ! npx -y firebase-tools hosting:sites:list \
  --project="$TARGET_PROJECT_ID" --json |
  jq -e --arg site "$FIREBASE_SITE_ID" \
    '.result.sites[]? | select((.name | split("/") | last) == $site)' >/dev/null; then
  npx -y firebase-tools hosting:sites:create "$FIREBASE_SITE_ID" \
    --project="$TARGET_PROJECT_ID"
fi

firebase_config="$root/dashboard/firebase.migration.generated.json"
trap 'rm -f "$firebase_config"' EXIT
jq -n \
  --arg site "$FIREBASE_SITE_ID" \
  --arg service "$SERVICE_NAME" \
  --arg region "$TARGET_REGION" \
  '{
    hosting: {
      site: $site,
      public: "public",
      ignore: ["firebase.json", "firebase.*.json", "**/.*", "**/node_modules/**"],
      rewrites: [
        {source: "/api/**", run: {serviceId: $service, region: $region}},
        {source: "**", destination: "/index.html"}
      ]
    }
  }' > "$firebase_config"

(
  cd "$root/dashboard"
  npx -y firebase-tools deploy \
    --only=hosting \
    --config="$(basename "$firebase_config")" \
    --project="$TARGET_PROJECT_ID"
)

echo "deployment complete"
echo "service_url=$service_url"
echo "skill_url=${service_url}/skill"
echo "dashboard_url=$dashboard_url"
echo "next: SERVICE_URL=$service_url scripts/migration/verify-service.sh"
