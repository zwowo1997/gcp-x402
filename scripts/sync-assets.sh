#!/usr/bin/env bash
# Copy repo-canonical assets into the proxy so the service can serve them.
# The Cloud Run build context is proxy/, which can't reach ../skill or ../docs,
# so these copies must live inside proxy/public/. Run before `gcloud run deploy`.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cp "$root/skill/bigquery-public-data/SKILL.md" "$root/proxy/public/skill.md"
cp "$root/skill/gcp-x402-v3-preview/SKILL.md" "$root/proxy/public/v3-skill.md"
cp "$root/docs/index.html"                     "$root/proxy/public/architecture.html"
cp "$root/src/v3-contracts.ts"                 "$root/proxy/lib/v3-contracts.ts"
echo "synced -> proxy/: hosted assets and v3-contracts.ts"
