#!/usr/bin/env bash
set -euo pipefail

for command_name in gcloud jq; do
  command -v "$command_name" >/dev/null || {
    echo "missing required command: $command_name" >&2
    exit 1
  }
done

: "${SOURCE_PROJECT_ID:?set SOURCE_PROJECT_ID}"

SOURCE_REGION="${SOURCE_REGION:-asia-northeast1}"
SOURCE_TASKS_LOCATION="${SOURCE_TASKS_LOCATION:-asia-northeast1}"
MIGRATION_INVENTORY_FILE="${MIGRATION_INVENTORY_FILE:-/private/tmp/gcp-x402-source-inventory.json}"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

gcloud projects describe "$SOURCE_PROJECT_ID" \
  --format=json > "$work_dir/project.json"
gcloud run services list \
  --project="$SOURCE_PROJECT_ID" \
  --region="$SOURCE_REGION" \
  --format=json > "$work_dir/run.json"
gcloud iam service-accounts list \
  --project="$SOURCE_PROJECT_ID" \
  --format=json > "$work_dir/service-accounts.json"
gcloud secrets list \
  --project="$SOURCE_PROJECT_ID" \
  --format=json > "$work_dir/secrets.json"
gcloud spanner instances list \
  --project="$SOURCE_PROJECT_ID" \
  --format=json > "$work_dir/spanner.json"
gcloud tasks queues list \
  --project="$SOURCE_PROJECT_ID" \
  --location="$SOURCE_TASKS_LOCATION" \
  --format=json > "$work_dir/tasks.json"
gcloud artifacts repositories list \
  --project="$SOURCE_PROJECT_ID" \
  --location="$SOURCE_REGION" \
  --format=json > "$work_dir/artifacts.json"

jq -n \
  --slurpfile project "$work_dir/project.json" \
  --slurpfile run "$work_dir/run.json" \
  --slurpfile service_accounts "$work_dir/service-accounts.json" \
  --slurpfile secrets "$work_dir/secrets.json" \
  --slurpfile spanner "$work_dir/spanner.json" \
  --slurpfile tasks "$work_dir/tasks.json" \
  --slurpfile artifacts "$work_dir/artifacts.json" \
  '{
    generatedAt: (now | todateiso8601),
    sourceProject: {
      projectId: $project[0].projectId,
      projectNumber: $project[0].projectNumber,
      lifecycleState: $project[0].lifecycleState
    },
    cloudRun: [
      $run[0][] | {
        name: .metadata.name,
        region: .metadata.labels["cloud.googleapis.com/location"],
        latestReadyRevision: .status.latestReadyRevisionName,
        url: .status.url,
        image: .spec.template.spec.containers[0].image
      }
    ],
    serviceAccounts: [$service_accounts[0][] | .email],
    secretNames: [$secrets[0][] | .name],
    spannerInstances: [
      $spanner[0][] | {
        name: .name,
        config: .config,
        state: .state,
        processingUnits: .processingUnits,
        nodeCount: .nodeCount,
        edition: .edition
      }
    ],
    cleanupQueues: [
      $tasks[0][] | {
        name: .name,
        state: .state
      }
    ],
    artifactRepositories: [
      $artifacts[0][] | {
        name: .name,
        format: .format
      }
    ]
  }' > "$MIGRATION_INVENTORY_FILE"

chmod 600 "$MIGRATION_INVENTORY_FILE"
echo "source inventory written to $MIGRATION_INVENTORY_FILE"
echo "contains metadata and secret names only; no secret values or tenant data"
