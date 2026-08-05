import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("direct Desktop MCP connections receive the V3 payment-route instructions", async () => {
  const source = await readFile("src/index.ts", "utf8");
  assert.match(source, /instructions: NATIVE_SESSION_INSTRUCTIONS/);
  assert.match(source, /from "\.\/launcher\.js"/);
});
