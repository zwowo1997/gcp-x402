import assert from "node:assert/strict";
import test from "node:test";
import { renderSkillForOrigin } from "../proxy/lib/skill.js";

test("hosted skill advertises the replica origin", () => {
  const canonical = "https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app";
  const replica = "https://replica.example.run.app";
  const rendered = renderSkillForOrigin(`install ${canonical}/skill and use ${canonical}`, `${replica}/`);
  assert.equal(rendered, `install ${replica}/skill and use ${replica}`);
  assert.ok(!rendered.includes(canonical));
});

test("hosted legacy guides also advertise the replica origin", () => {
  const legacy = "https://gcp-x402-837831206506.us-central1.run.app";
  const replica = "https://replica.example.run.app";
  assert.equal(renderSkillForOrigin(`${legacy}/skill`, replica), `${replica}/skill`);
});
