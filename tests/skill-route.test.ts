import assert from "node:assert/strict";
import test from "node:test";
import { publicSkillOrigin, renderSkillForOrigin } from "../proxy/lib/skill.js";
import { readFile } from "node:fs/promises";

test("hosted skill advertises the replica origin", () => {
  const canonical = "https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app";
  const replica = "https://replica.example.run.app";
  const rendered = renderSkillForOrigin(`install ${canonical}/skill and use ${canonical}`, `${replica}/`);
  assert.equal(rendered, `install ${replica}/skill and use ${replica}`);
  assert.ok(!rendered.includes(canonical));
});

test("hosted skill prefers PUBLIC_BASE_URL over the container listener", () => {
  assert.equal(
    publicSkillOrigin("https://0.0.0.0:8080/skill", "https://preview.example.run.app/"),
    "https://preview.example.run.app",
  );
});

test("dedicated preview skill separates MoonPay showcase from V2 testnet payment", async () => {
  const source = await readFile("skill/gcp-x402-v3-preview/SKILL.md", "utf8");
  assert.match(source, /exact working directory/);
  assert.match(source, /github:zwowo1997\/gcp-x402/);
  assert.match(source, /testnet USDC/i);
  assert.match(source, /real-money on-ramp showcase/i);
  assert.match(source, /topup moonpay/);
  assert.match(source, /trading-deploy/);
});

test("v3 preview skill leads agents through the sandbox CLI journey", async () => {
  const source = await readFile("skill/gcp-x402-v3-preview/SKILL.md", "utf8");
  assert.match(source, /sandbox/);
  assert.match(source, /setup --sandbox/);
  assert.match(source, /plan/);
});

test("preview skill keeps the V2 testnet service separate from its rendered V3 origin", async () => {
  const source = await readFile("skill/gcp-x402-v3-preview/SKILL.md", "utf8");
  const preview = "https://preview.example.run.app";
  const rendered = renderSkillForOrigin(source, preview);
  assert.match(rendered, new RegExp(`${preview.replaceAll(".", "\\.")}.*topup moonpay`));
  assert.match(rendered, /https:\/\/gcp-x402-tokyo-837831206506\.asia-northeast1\.run\.app.*trading-deploy/);
});

test("hosted legacy guides also advertise the replica origin", () => {
  const legacy = "https://gcp-x402-837831206506.us-central1.run.app";
  const replica = "https://replica.example.run.app";
  assert.equal(renderSkillForOrigin(`${legacy}/skill`, replica), `${replica}/skill`);
});
