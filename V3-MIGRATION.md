# V3 beta migration and release guide

This guide is for an AI coding agent migrating v3 to a separate GCP project.
It does **not** authorize deployment, enable real payments, copy data, or copy secrets.
V2 remains a separate rollback point; do not replace it in place.

## V3 scope

- Separate `/api/v3/*` simulation surface and `/v3-demo` checkout preview.
- 15, 30, and 60 minute plans with displayed expected charge and authorization cap.
- AP2-derived EVM mandate draft binding payer, request, duration, quote and expiry.
- Coinbase sandbox handoff simulation only.
- No Cloud resources, stablecoin transaction, live exchange order, card data, or KYC data.

The beta contract is not a full AP2 Trusted Surface. Do not claim user-signed AP2
consent until an independently controlled signing surface and compatible x402 v2
facilitator have passed integration tests.

## Independent target setup

1. Clone the exact Git tag/commit. Do not copy working directories, `.gcp-x402`,
   Firebase state, Firestore documents, Spanner rows, user wallets, capabilities,
   receipts, images, or secret values.
2. Copy `migration/config.example.env` outside Git, give it mode 600, choose a new
   project/Firebase site/receiving address, and generate fresh control secrets.
3. Read the v2 baseline [MIGRATION.md](./MIGRATION.md). Its bootstrap is billable
   because Spanner has recurring cost; it requires explicit acknowledgement.
4. Run a read-only release plan:

   ```bash
   scripts/release.sh plan --config /private/tmp/gcp-x402-target.env --version v3.0.0-beta.1
   ```

5. Run local verification before a target deployment:

   ```bash
   npm ci && (cd proxy && npm ci)
   npm test && npm run typecheck && (cd proxy && npm run typecheck)
   ```

6. Only after human approval, use `scripts/release.sh bootstrap|deploy|verify ...
   --allow-mutation`. The explicit flag is required even when the configuration is valid.
7. Keep `X402_NETWORK=base-sepolia`, `TEST_MODE=true`, and `V3_REAL_SETTLEMENT_ENABLED=false`.
   Verify `/api/v3/catalog` and a POST to `/api/v3/simulate`; both must be free and
   must not make a payment challenge or provision resources.

## Required production gates (not included in beta)

1. Coinbase CDP project, Embedded Wallet and Onramp credentials stored only in Secret Manager.
2. Jurisdiction, KYC, sanctions, limits, card-network and disclosure review. Never promise
   KYC-free conversion; a hosted provider may request verification.
3. A real Coinbase sandbox integration with webhook signature verification and idempotent order state.
4. A compatible x402 v2 `upto` facilitator test that proves settlement is at or below the
   mandate cap, settles only after provisioning, and leaves unused authorization untransferred.
5. EIP-712/AP2 mandate verification on the server, nonce consumption in Firestore, replay and
   expiry tests, and a user-controlled trusted signing surface.
6. GCP per-tenant quotas, budget alerts, explicit failure cleanup, security review, and a
   human-approved tiny paid acceptance test.

## Release record and rollback

Every deployment must record the Git commit, Git tag, image digests, Cloud Run revision,
dashboard/skill URLs, configuration schema version, migration guide version, and environment
template revision. `scripts/release.sh` writes `release-manifest.json` on mutation actions;
review and commit it with the release record only after removing target-specific identifiers if
the repository is public.

Rollback returns traffic to a known ready Cloud Run revision; it never deletes Spanner,
Firestore, secrets, or tenant data. Use the `rollback` action with `ROLLBACK_REVISION` in the
external config, after human approval.
