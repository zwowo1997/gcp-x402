import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const scripts = [
  "scripts/migration/inventory-source.sh",
  "scripts/migration/bootstrap-project.sh",
  "scripts/migration/deploy-service.sh",
  "scripts/migration/verify-service.sh",
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
