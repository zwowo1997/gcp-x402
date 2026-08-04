#!/usr/bin/env bash
# V3 release coordinator. `plan` is read-only; all mutations require an explicit flag.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
action="${1:-plan}"
shift || true
config_file=""
version=""
allow_mutation="no"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) config_file="${2:?missing config path}"; shift 2 ;;
    --version) version="${2:?missing version}"; shift 2 ;;
    --allow-mutation) allow_mutation="yes"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$config_file" || -z "$version" ]]; then
  echo "usage: scripts/release.sh <plan|bootstrap|deploy|verify|rollback> --config /path/project.env --version vX.Y.Z [--allow-mutation]" >&2
  exit 2
fi
[[ -r "$config_file" ]] || { echo "configuration file is not readable: $config_file" >&2; exit 2; }
# shellcheck disable=SC1090
source "$config_file"
: "${TARGET_PROJECT_ID:?TARGET_PROJECT_ID is required}"

commit="$(git -C "$root" rev-parse HEAD)"
short_commit="$(git -C "$root" rev-parse --short=12 HEAD)"
manifest="$root/release-manifest.json"
write_manifest() {
  local onramp="simulator"
  if [[ -n "${MOONPAY_PUBLIC_KEY:-}" ]]; then onramp="moonpay-test-hosted"; fi
  node -e 'const fs=require("fs"); const [path,version,commit,project,region,onramp]=process.argv.slice(1); fs.writeFileSync(path, JSON.stringify({schemaVersion:2,release:version,sourceCommit:commit,targetProject:project,targetRegion:region,interfaces:{skill:"v3",mcp:"v3",payment:"x402-v2-upto-contract-preview",onramp},realSettlement:false,verification:"not-run",generatedAt:new Date().toISOString()},null,2)+"\n")' "$manifest" "$version" "$commit" "$TARGET_PROJECT_ID" "${TARGET_REGION:-asia-northeast1}" "$onramp"
}
finalize_manifest() {
  local phase="$1" revision="${2:-}" proxy_digest="${3:-}" runtime_digest="${4:-}" skill_sha="${5:-}" dashboard_url="${6:-}"
  node -e 'const fs=require("fs"); const [path,phase,revision,proxyDigest,runtimeDigest,skillSha,dashboardUrl]=process.argv.slice(1); const data=JSON.parse(fs.readFileSync(path,"utf8")); data.phase=phase; if(revision)data.cloudRunRevision=revision; if(proxyDigest)data.proxyImageDigest=proxyDigest; if(runtimeDigest)data.tradingRuntimeImageDigest=runtimeDigest; if(skillSha)data.skillSha256=skillSha; if(dashboardUrl)data.dashboardUrl=dashboardUrl; data.generatedAt=new Date().toISOString(); fs.writeFileSync(path,JSON.stringify(data,null,2)+"\n");' "$manifest" "$phase" "$revision" "$proxy_digest" "$runtime_digest" "$skill_sha" "$dashboard_url"
}

case "$action" in
  plan)
    echo "v3 release plan"
    echo "version=$version"
    echo "commit=$commit"
    echo "target_project=$TARGET_PROJECT_ID"
    echo "target_region=${TARGET_REGION:-asia-northeast1}"
    echo "mutation=disabled"
    echo "real_settlement=disabled"
    echo "next: review V3-MIGRATION.md, then use bootstrap/deploy/verify with --allow-mutation"
    ;;
  bootstrap|deploy|verify|rollback)
    [[ "$allow_mutation" == "yes" ]] || { echo "$action can mutate a target project; repeat with --allow-mutation after human review." >&2; exit 3; }
    write_manifest
    case "$action" in
      bootstrap)
        "$root/scripts/migration/bootstrap-v3-preview.sh"
        finalize_manifest "bootstrapped"
        ;;
      deploy)
        "$root/scripts/migration/deploy-v3-preview.sh"
        service_name="${SERVICE_NAME:-gcp-x402-v3-preview}"
        service_url="$(gcloud run services describe "$service_name" --project="$TARGET_PROJECT_ID" --region="${TARGET_REGION:-asia-northeast1}" --format='value(status.url)')"
        revision="$(gcloud run services describe "$service_name" --project="$TARGET_PROJECT_ID" --region="${TARGET_REGION:-asia-northeast1}" --format='value(status.latestReadyRevisionName)')"
        registry="${TARGET_REGION:-asia-northeast1}-docker.pkg.dev/${TARGET_PROJECT_ID}/${ARTIFACT_REPOSITORY:-gcp-x402}"
        proxy_digest="$(gcloud artifacts docker images describe "$registry/v3-preview:$short_commit" --format='value(image_summary.digest)' 2>/dev/null || true)"
        runtime_digest=""
        skill_sha="$(curl -fsSL "$service_url/skill" | shasum -a 256 | awk '{print $1}')"
        finalize_manifest "deployed" "$revision" "$proxy_digest" "$runtime_digest" "$skill_sha" "${service_url}/v3-demo"
        ;;
      verify)
        SERVICE_URL="${SERVICE_URL:-}" "$root/scripts/migration/verify-v3.sh"
        finalize_manifest "verified"
        node -e 'const fs=require("fs");const path=process.argv[1];const data=JSON.parse(fs.readFileSync(path,"utf8"));data.verification="passed";fs.writeFileSync(path,JSON.stringify(data,null,2)+"\n")' "$manifest"
        ;;
      rollback)
        : "${ROLLBACK_REVISION:?set ROLLBACK_REVISION in the config file}"
        gcloud run services update-traffic "${SERVICE_NAME:-gcp-x402-v3-preview}" --project="$TARGET_PROJECT_ID" --region="${TARGET_REGION:-asia-northeast1}" --to-revisions="${ROLLBACK_REVISION}=100"
        finalize_manifest "rolled-back" "${ROLLBACK_REVISION}"
        ;;
    esac
    ;;
  *) echo "unknown action: $action" >&2; exit 2 ;;
esac

if [[ -f "$manifest" ]]; then echo "release_manifest=$manifest"; fi
echo "commit_short=$short_commit"
