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

test("dedicated preview skill uses the unified native MCP instead of V2 fallback", async () => {
  const source = await readFile("skill/gcp-x402-v3-preview/SKILL.md", "utf8");
  assert.match(source, /github:zwowo1997\/gcp-x402/);
  assert.match(source, /testnet USDC/i);
  assert.match(source, /v3_trading_catalog/);
  assert.match(source, /v3_trading_quote/);
  assert.match(source, /v3_trading_deploy/);
  assert.match(source, /Do not use V2 commands as a fallback/);
});

test("v3 preview skill keeps unlock and MoonPay inside the native session", async () => {
  const source = await readFile("skill/gcp-x402-v3-preview/SKILL.md", "utf8");
  assert.match(source, /unlock_service/);
  assert.match(source, /moonpay_showcase/);
  assert.match(source, /Do not ask the user to run another terminal command/);
  assert.match(source, /buy-sandbox\.moonpay\.com/);
});

test("preview skill contains no hard-coded deployment origin", async () => {
  const source = await readFile("skill/gcp-x402-v3-preview/SKILL.md", "utf8");
  const preview = "https://preview.example.run.app";
  const rendered = renderSkillForOrigin(source, preview);
  assert.equal(rendered, source);
  assert.doesNotMatch(rendered, /gcp-x402-tokyo-837831206506/);
});

test("hosted legacy guides also advertise the replica origin", () => {
  const legacy = "https://gcp-x402-837831206506.us-central1.run.app";
  const replica = "https://replica.example.run.app";
  assert.equal(renderSkillForOrigin(`${legacy}/skill`, replica), `${replica}/skill`);
});
