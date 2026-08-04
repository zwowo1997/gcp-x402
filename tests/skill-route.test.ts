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

test("dedicated v3 preview skill cannot initiate legacy paid commands", async () => {
  const source = await readFile("skill/gcp-x402-v3-preview/SKILL.md", "utf8");
  assert.match(source, /exact working directory/);
  assert.match(source, /github:zwowo1997\/gcp-x402/);
  assert.match(source, /No money transferred and no cloud or trading resources were created/);
  assert.doesNotMatch(source, /\n\s*PROXY_URL=.* (wallet|query|provision|trading-deploy)( |\n)/);
});

test("v3 preview skill leads agents through the sandbox CLI journey", async () => {
  const source = await readFile("skill/gcp-x402-v3-preview/SKILL.md", "utf8");
  assert.match(source, /sandbox/);
  assert.match(source, /setup --sandbox/);
  assert.match(source, /plan/);
});

test("hosted legacy guides also advertise the replica origin", () => {
  const legacy = "https://gcp-x402-837831206506.us-central1.run.app";
  const replica = "https://replica.example.run.app";
  assert.equal(renderSkillForOrigin(`${legacy}/skill`, replica), `${replica}/skill`);
});
