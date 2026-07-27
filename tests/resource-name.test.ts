import assert from "node:assert/strict";
import test from "node:test";
import { tradingResourceName } from "../proxy/lib/trading/resource-name.js";

test("truncated UUID resource names never end with a hyphen", () => {
  const name = tradingResourceName("hl-writer", "afcc9cc0-bb00-4483-ba4e-123456789abc");
  assert.equal(name, "hl-writer-afcc9cc0-bb00-4483-ba4e");
  assert.match(name, /^[a-z][a-z0-9-]{0,48}[a-z0-9]$/);
});
