#!/usr/bin/env bash
set -euo pipefail

for command_name in curl gcloud jq; do
  command -v "$command_name" >/dev/null || {
    echo "missing required command: $command_name" >&2
    exit 1
  }
done

: "${TARGET_PROJECT_ID:?set TARGET_PROJECT_ID}"
: "${FIREBASE_SITE_ID:?set FIREBASE_SITE_ID}"

TARGET_REGION="${TARGET_REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-gcp-x402-tokyo}"
TASKS_QUEUE="${TASKS_QUEUE:-gcp-x402-cleanup}"
SPANNER_INSTANCE="${SPANNER_INSTANCE:-hyperliquid-test}"
SPANNER_DATABASE="${SPANNER_DATABASE:-hyperliquid-demo}"

SERVICE_URL="${SERVICE_URL:-$(gcloud run services describe "$SERVICE_NAME" \
  --region="$TARGET_REGION" \
  --project="$TARGET_PROJECT_ID" \
  --format='value(status.url)')}"
DASHBOARD_URL="https://${FIREBASE_SITE_ID}.web.app"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

curl -fsSL "$SERVICE_URL/skill" -o "$work_dir/skill.md"
grep -q "one-hour Tokyo Hyperliquid" "$work_dir/skill.md"
grep -q "trading-deploy --new" "$work_dir/skill.md"
grep -q "estimatedLeaseUsd" "$work_dir/skill.md"

# Use Secret Manager without printing or persisting the password beyond this
# short-lived private temporary directory.
password_value="$(gcloud secrets versions access latest \
  --secret=gcp-x402-beta-password \
  --project="$TARGET_PROJECT_ID")"
jq -n --arg password "$password_value" '{password:$password}' \
  > "$work_dir/unlock.json"
unset password_value

curl -fsSL -X POST \
  -H 'content-type: application/json' \
  --data-binary "@$work_dir/unlock.json" \
  "$SERVICE_URL/api/beta/unlock" \
  -o "$work_dir/session.json"
session_value="$(jq -er '.token' "$work_dir/session.json")"

catalog_status="$(curl -sS \
  -H "x-gcp-x402-session: $session_value" \
  -o "$work_dir/catalog.json" \
  -w '%{http_code}' \
  "$SERVICE_URL/api/trading/catalog")"
[[ "$catalog_status" == "200" ]]
jq -e '
  .profile.durationHours == 1 and
  .profile.region == "asia-northeast1" and
  .profile.priceCeilingUsd == 5 and
  (.estimatedResources | length) == 7 and
  .costSummary.estimatedGcpUsageUsd > 0
' "$work_dir/catalog.json" >/dev/null

payment_status="$(curl -sS -X POST \
  -H "x-gcp-x402-session: $session_value" \
  -H 'content-type: application/json' \
  --data '{"profileId":"trading.paper.ema","requestId":"migration-verification-no-payment","config":{"symbol":"BTC"}}' \
  -o "$work_dir/payment.json" \
  -w '%{http_code}' \
  "$SERVICE_URL/api/trading/deploy")"
[[ "$payment_status" == "402" ]]
jq -e '
  (.accepts | length) == 1 and
  .accepts[0].maxAmountRequired == "5000000" and
  (.accepts[0].description | contains("1-hour"))
' "$work_dir/payment.json" >/dev/null

firebase_status="$(curl -sS \
  -H "x-gcp-x402-session: $session_value" \
  -o "$work_dir/firebase-catalog.json" \
  -w '%{http_code}' \
  "$DASHBOARD_URL/api/trading/catalog")"
[[ "$firebase_status" == "200" ]]
jq -e '.profile.durationHours == 1' "$work_dir/firebase-catalog.json" >/dev/null

queue_state="$(gcloud tasks queues describe "$TASKS_QUEUE" \
  --location="$TARGET_REGION" \
  --project="$TARGET_PROJECT_ID" \
  --format='value(state)')"
[[ "$queue_state" == "RUNNING" ]]

database_state="$(gcloud spanner databases describe "$SPANNER_DATABASE" \
  --instance="$SPANNER_INSTANCE" \
  --project="$TARGET_PROJECT_ID" \
  --format='value(state)')"
[[ "$database_state" == "READY" ]]

revision="$(gcloud run services describe "$SERVICE_NAME" \
  --region="$TARGET_REGION" \
  --project="$TARGET_PROJECT_ID" \
  --format='value(status.latestReadyRevisionName)')"

echo "verification passed"
echo "revision=$revision"
echo "service_url=$SERVICE_URL"
echo "skill_url=$SERVICE_URL/skill"
echo "dashboard_url=$DASHBOARD_URL"
echo "payment_test=402_only_no_charge"
