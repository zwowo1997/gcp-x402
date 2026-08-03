import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const scripts = [
  "scripts/migration/inventory-source.sh",
  "scripts/migration/bootstrap-project.sh",
  "scripts/migration/deploy-service.sh",
  "scripts/migration/verify-service.sh",
  "scripts/migration/verify-v3.sh",
];

test("migration scripts are executable and do not embed the source project", async () => {
  for (const path of scripts) {
    const [source, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    assert.ok((metadata.mode & 0o111) !== 0, `${path} must be executable`);
    assert.ok(!source.includes("837831206506"), `${path} must not embed the source project number`);
  }
});

test("migration bootstrap requires explicit billable Spanner acknowledgement", async () => {
  const source = await readFile("scripts/migration/bootstrap-project.sh", "utf8");
  assert.match(source, /ALLOW_BILLABLE_BOOTSTRAP/);
  assert.match(source, /processing-units=100/);
  assert.match(source, /BETA_PASSWORD_FILE/);
  assert.doesNotMatch(source, /BETA_ACCESS_PASSWORD=/);
});

test("migration verifier cannot initiate a paid deployment", async () => {
  const source = await readFile("scripts/migration/verify-service.sh", "utf8");
  assert.match(source, /payment_status/);
  assert.match(source, /\[\[ "\$payment_status" == "402" \]\]/);
  assert.doesNotMatch(source, /X-PAYMENT|x-payment/);
});

test("v3 release coordinator requires a configuration file, version, and explicit mutation flag", async () => {
  const [source, metadata, guide] = await Promise.all([
    readFile("scripts/release.sh", "utf8"), stat("scripts/release.sh"), readFile("V3-MIGRATION.md", "utf8"),
  ]);
  assert.ok((metadata.mode & 0o111) !== 0, "scripts/release.sh must be executable");
  assert.match(source, /--allow-mutation/);
  assert.match(source, /real_settlement=disabled/);
  assert.match(guide, /V3_REAL_SETTLEMENT_ENABLED=false/);
  assert.match(guide, /Do not claim user-signed AP2/);
  const deploy = await readFile("scripts/migration/deploy-service.sh", "utf8");
  assert.match(deploy, /V3_REAL_SETTLEMENT_ENABLED=false/);
  assert.match(deploy, /not implemented in this beta release/);
  const v3Verifier = await readFile("scripts/migration/verify-v3.sh", "utf8");
  assert.match(v3Verifier, /realSettlementEnabled == false/);
  assert.match(v3Verifier, /checkout_approved_funded_running_simulated/);
  assert.match(source, /\$manifest/);
});
