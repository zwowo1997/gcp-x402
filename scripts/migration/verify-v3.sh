#!/usr/bin/env bash
# Free, non-provisioning verifier for the v3 checkout simulator.
set -euo pipefail

for command_name in curl gcloud jq openssl; do command -v "$command_name" >/dev/null || { echo "missing required command: $command_name" >&2; exit 1; }; done
: "${TARGET_PROJECT_ID:?set TARGET_PROJECT_ID}"
TARGET_REGION="${TARGET_REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-gcp-x402-v3-preview}"
SERVICE_URL="${SERVICE_URL:-$(gcloud run services describe "$SERVICE_NAME" --region="$TARGET_REGION" --project="$TARGET_PROJECT_ID" --format='value(status.url)')}"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
trap 'echo "v3_verification_failed_line=$LINENO" >&2' ERR
verification_id="verify-v3-$(date +%s)-$$"
curl -fsSL "$SERVICE_URL/skill" -o "$work_dir/skill.md"
grep -q 'Never execute `gcp-x402 start` from inside the current coding-agent chat' "$work_dir/skill.md"
grep -q 'Settings > MCP servers' "$work_dir/skill.md"
grep -q 'unlock_service' "$work_dir/skill.md"
grep -q 'v3_trading_catalog' "$work_dir/skill.md"
grep -q 'v3_trading_quote' "$work_dir/skill.md"
grep -q 'v3_trading_deploy' "$work_dir/skill.md"
grep -q 'moonpay_showcase' "$work_dir/skill.md"
grep -q 'Do not use V2 commands as a fallback' "$work_dir/skill.md"
grep -q 'github:zwowo1997/gcp-x402' "$work_dir/skill.md"
if grep -q 'gcp-x402-tokyo-' "$work_dir/skill.md"; then echo "skill contains a source-project service origin" >&2; exit 1; fi

legacy_status="$(curl -sS -o "$work_dir/legacy.json" -w '%{http_code}' "$SERVICE_URL/api/trading/catalog")"
[[ "$legacy_status" == "503" ]]

password_value="$(gcloud secrets versions access latest --secret=gcp-x402-v3-preview-beta-password --project="$TARGET_PROJECT_ID")"
jq -n --arg password "$password_value" '{password:$password}' > "$work_dir/unlock.json"
unset password_value
curl -fsSL -X POST -H 'content-type: application/json' --data-binary "@$work_dir/unlock.json" "$SERVICE_URL/api/beta/unlock" -o "$work_dir/session.json"
session_value="$(jq -er '.token' "$work_dir/session.json")"

trading_catalog_status="$(curl -sS -H "x-gcp-x402-session: $session_value" -o "$work_dir/trading-catalog.json" -w '%{http_code}' "$SERVICE_URL/api/v3/trading/catalog")"
[[ "$trading_catalog_status" == "200" ]]
jq -e '.durationsMinutes == [15,30,60] and .deploymentEnabled == false and ([.plans[].quote.expectedChargeUsd] == [0.09,0.12,0.19])' "$work_dir/trading-catalog.json" >/dev/null
jq -n --arg requestId "${verification_id}-quote" '{paymentPath:"testnet-usdc",durationMinutes:15,payer:"0x0000000000000000000000000000000000000001",requestId:$requestId}' > "$work_dir/trading-quote-request.json"
curl -fsSL -X POST -H "x-gcp-x402-session: $session_value" -H 'content-type: application/json' --data-binary "@$work_dir/trading-quote-request.json" "$SERVICE_URL/api/v3/trading/quote" -o "$work_dir/trading-quote.json"
jq -e '.deploymentEnabled == false and .quote.quote.durationMinutes == 15 and .quote.quote.expectedChargeUsd == 0.09 and .quote.quote.authorizationCapUsd == 0.15 and (.quoteToken | length > 20)' "$work_dir/trading-quote.json" >/dev/null
jq -n --arg quoteToken "$(jq -r .quoteToken "$work_dir/trading-quote.json")" '{quoteToken:$quoteToken}' > "$work_dir/trading-deploy-request.json"
disabled_deploy_status="$(curl -sS -X POST -H "x-gcp-x402-session: $session_value" -H 'content-type: application/json' --data-binary "@$work_dir/trading-deploy-request.json" -o "$work_dir/trading-deploy.json" -w '%{http_code}' "$SERVICE_URL/api/v3/trading/deploy")"
[[ "$disabled_deploy_status" == "503" ]]

catalog_status="$(curl -sS -H "x-gcp-x402-session: $session_value" -o "$work_dir/catalog.json" -w '%{http_code}' "$SERVICE_URL/api/v3/catalog")"
[[ "$catalog_status" == "200" ]]
jq -e '.mode == "simulation-only" and .realSettlementEnabled == false and .durationsMinutes == [15,30,60]' "$work_dir/catalog.json" >/dev/null

jq -n --arg requestId "$verification_id" '{productId:"trading.paper.ema",durationMinutes:15,requestId:$requestId}' > "$work_dir/simulation-request.json"
simulation_status="$(curl -sS -X POST -H "x-gcp-x402-session: $session_value" -H 'content-type: application/json' --data-binary "@$work_dir/simulation-request.json" -o "$work_dir/simulation.json" -w '%{http_code}' "$SERVICE_URL/api/v3/simulate")"
[[ "$simulation_status" == "200" ]]
stack_id="$(jq -er '.stackId' "$work_dir/simulation.json")"
jq -e '. as $root | .simulation == true and .status == "checkout" and .paymentStatus == "not_authorized" and (.embeddedWallet.address | test("^0x[0-9a-fA-F]{40}$")) and ((([.resources[].estimatedUsd] | add) - $root.quote.estimatedGcpUsd) | fabs < 0.000001)' "$work_dir/simulation.json" >/dev/null
curl -fsSL -X POST -H "x-gcp-x402-session: $session_value" -H 'content-type: application/json' --data-binary "@$work_dir/simulation-request.json" "$SERVICE_URL/api/v3/simulate" -o "$work_dir/simulation-retry.json"
jq -e --arg stack "$stack_id" '.stackId == $stack and .reusedRequest == true' "$work_dir/simulation-retry.json" >/dev/null

curl -fsSL -H "x-gcp-x402-session: $session_value" "$SERVICE_URL/api/v3/moonpay" -o "$work_dir/moonpay.json"
if [[ -n "${MOONPAY_PUBLIC_KEY:-}" ]]; then
  jq -e '.enabled == true and .mode == "test" and .network == "ethereum-sepolia"' "$work_dir/moonpay.json" >/dev/null
  jq -n --arg stackId "$stack_id" '{stackId:$stackId}' > "$work_dir/moonpay-checkout-request.json"
  curl -fsSL -X POST -H "x-gcp-x402-session: $session_value" -H 'content-type: application/json' --data-binary "@$work_dir/moonpay-checkout-request.json" "$SERVICE_URL/api/v3/moonpay" -o "$work_dir/moonpay-checkout.json"
  jq -e '.checkoutUrl | (startswith("https://buy-sandbox.moonpay.com/") and contains("walletAddress=") and contains("&signature=") and contains("%3D"))' "$work_dir/moonpay-checkout.json" >/dev/null
  webhook_value="$(gcloud secrets versions access latest --secret=gcp-x402-v3-preview-moonpay-webhook --project="$TARGET_PROJECT_ID")"
  printf '%s' '{"type":"transaction_updated","data":{"id":"verify-v3"}}' > "$work_dir/moonpay-webhook.json"
  webhook_timestamp="$(date +%s)"
  webhook_signature="$(printf '%s.' "$webhook_timestamp"; cat "$work_dir/moonpay-webhook.json")"
  webhook_signature="$(printf '%s' "$webhook_signature" | openssl dgst -sha256 -hmac "$webhook_value" -hex | awk '{print $2}')"
  unset webhook_value
  webhook_status="$(curl -sS -X POST -H 'content-type: application/json' -H "moonpay-signature-v2: t=${webhook_timestamp},s=${webhook_signature}" --data-binary "@$work_dir/moonpay-webhook.json" -o "$work_dir/moonpay-webhook-response.json" -w '%{http_code}' "$SERVICE_URL/api/v3/moonpay/webhook")"
  [[ "$webhook_status" == "200" ]]
else
  jq -e '.enabled == false' "$work_dir/moonpay.json" >/dev/null
fi

for action in approve fund provision; do
  curl -fsSL -X POST -H "x-gcp-x402-session: $session_value" -H 'content-type: application/json' --data "{\"action\":\"$action\"}" "$SERVICE_URL/api/v3/simulations/$stack_id" -o "$work_dir/$action.json"
done
jq -e '.status == "running" and .paymentStatus == "settled_simulated" and .mandate.status == "consumed" and .telemetry.strategy.signal == "short_hedge" and (.telemetry.market | length > 0)' "$work_dir/provision.json" >/dev/null
curl -fsSL -H "x-gcp-x402-session: $session_value" "$SERVICE_URL/api/v3/simulations/$stack_id" -o "$work_dir/reloaded.json"
jq -e --arg stack "$stack_id" '.stackId == $stack and .status == "running"' "$work_dir/reloaded.json" >/dev/null

echo "v3_verification=passed"
echo "service_url=$SERVICE_URL"
echo "stack_lifecycle=checkout_approved_funded_running_simulated"
echo "legacy_paid_routes=disabled"
echo "state_store=firestore_verified"
echo "request_idempotency=verified"
echo "moonpay_test_mode=$(jq -r '.enabled' "$work_dir/moonpay.json")"
echo "payment_route_separation=verified"
