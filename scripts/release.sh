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
  node -e 'const fs=require("fs"); const [version,commit,project,region]=process.argv.slice(1); fs.writeFileSync("release-manifest.json", JSON.stringify({schemaVersion:1,release:version,commit,targetProject:project,targetRegion:region,interfaces:{skill:"v3",mcp:"v3",payment:"x402-v2-upto-contract-preview",onramp:"coinbase-sandbox"},realSettlement:false,generatedAt:new Date().toISOString()},null,2)+"\n")' "$version" "$commit" "$TARGET_PROJECT_ID" "${TARGET_REGION:-asia-northeast1}"
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
      bootstrap) exec "$root/scripts/migration/bootstrap-project.sh" ;;
      deploy) exec "$root/scripts/migration/deploy-service.sh" ;;
      verify) exec "$root/scripts/migration/verify-service.sh" ;;
      rollback)
        : "${ROLLBACK_REVISION:?set ROLLBACK_REVISION in the config file}"
        exec gcloud run services update-traffic "${SERVICE_NAME:-gcp-x402-tokyo}" --project="$TARGET_PROJECT_ID" --region="${TARGET_REGION:-asia-northeast1}" --to-revisions="${ROLLBACK_REVISION}=100"
        ;;
    esac
    ;;
  *) echo "unknown action: $action" >&2; exit 2 ;;
esac

if [[ -f "$manifest" ]]; then echo "release_manifest=$manifest"; fi
echo "commit_short=$short_commit"
