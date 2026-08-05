#!/usr/bin/env bash
# Deploy only the free v3 simulator. Legacy paid APIs are denied by middleware.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
for command_name in gcloud git; do command -v "$command_name" >/dev/null || { echo "missing required command: $command_name" >&2; exit 1; }; done
: "${TARGET_PROJECT_ID:?set TARGET_PROJECT_ID}"
: "${PAY_TO_ADDRESS:?set PAY_TO_ADDRESS to a syntactically valid preview address}"
[[ "$PAY_TO_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "PAY_TO_ADDRESS must be a 20-byte EVM address" >&2; exit 1; }
[[ "${V3_PREVIEW_ONLY:-true}" == "true" ]] || { echo "this deployment path requires V3_PREVIEW_ONLY=true" >&2; exit 1; }
[[ "${V3_REAL_SETTLEMENT_ENABLED:-false}" == "false" ]] || { echo "real settlement is forbidden in preview" >&2; exit 1; }

TARGET_REGION="${TARGET_REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-gcp-x402-v3-preview}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-gcp-x402}"
commit_id="$(git -C "$root" rev-parse --short=12 HEAD)"
image="${TARGET_REGION}-docker.pkg.dev/${TARGET_PROJECT_ID}/${ARTIFACT_REPOSITORY}/v3-preview:${commit_id}"
secret_bindings="QUOTE_SECRET=gcp-x402-v3-preview-quote-secret:latest,RESOURCE_CAPABILITY_SECRET=gcp-x402-v3-preview-resource-capability:latest,BETA_ACCESS_PASSWORD=gcp-x402-v3-preview-beta-password:latest,BETA_SESSION_SECRET=gcp-x402-v3-preview-beta-session-secret:latest"
env_vars="^|^X402_NETWORK=base-sepolia|TEST_MODE=true|V3_PREVIEW_ONLY=true|V3_SIMULATION_STORE=firestore|V3_REAL_SETTLEMENT_ENABLED=false|V3_TESTNET_DEPLOY_ENABLED=false|PAY_TO_ADDRESS=${PAY_TO_ADDRESS}|GCP_PROJECT_ID=${TARGET_PROJECT_ID}|PUBLIC_BASE_URL=https://migration.invalid"
if [[ -n "${MOONPAY_PUBLIC_KEY:-}" ]]; then
  [[ "$MOONPAY_PUBLIC_KEY" == pk_test_* ]] || { echo "V3 accepts only a MoonPay pk_test_ publishable key" >&2; exit 1; }
  [[ "${MOONPAY_FIAT_AMOUNT_USD:-30}" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "MOONPAY_FIAT_AMOUNT_USD must be numeric" >&2; exit 1; }
  gcloud secrets describe gcp-x402-v3-preview-moonpay-signing --project="$TARGET_PROJECT_ID" >/dev/null
  gcloud secrets describe gcp-x402-v3-preview-moonpay-webhook --project="$TARGET_PROJECT_ID" >/dev/null
  secret_bindings+=",MOONPAY_SECRET_KEY=gcp-x402-v3-preview-moonpay-signing:latest,MOONPAY_WEBHOOK_KEY=gcp-x402-v3-preview-moonpay-webhook:latest"
  env_vars+="|MOONPAY_PUBLIC_KEY=${MOONPAY_PUBLIC_KEY}|MOONPAY_FIAT_AMOUNT_USD=${MOONPAY_FIAT_AMOUNT_USD:-30}"
fi
"$root/scripts/sync-assets.sh"
gcloud builds submit "$root/proxy" --tag="$image" --project="$TARGET_PROJECT_ID"

gcloud run deploy "$SERVICE_NAME" --image="$image" --region="$TARGET_REGION" --project="$TARGET_PROJECT_ID" --allow-unauthenticated \
  --service-account="gcp-x402-v3-preview-run@${TARGET_PROJECT_ID}.iam.gserviceaccount.com" --cpu=1 --memory=512Mi --timeout=60s --min-instances=0 --max-instances=1 \
  --set-secrets="$secret_bindings" \
  --set-env-vars="$env_vars"
service_url="$(gcloud run services describe "$SERVICE_NAME" --region="$TARGET_REGION" --project="$TARGET_PROJECT_ID" --format='value(status.url)')"
gcloud run services update "$SERVICE_NAME" --region="$TARGET_REGION" --project="$TARGET_PROJECT_ID" --update-env-vars="PUBLIC_BASE_URL=${service_url}" >/dev/null
echo "service_url=$service_url"
echo "skill_url=${service_url}/skill"
echo "dashboard_url=${service_url}/v3-demo"
