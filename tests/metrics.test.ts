import assert from "node:assert/strict";
import test from "node:test";
import { spannerValueOf } from "../proxy/lib/trading/spanner-value.js";

test("Spanner metrics decode primitive REST values", () => {
  assert.equal(spannerValueOf("2026-07-27T20:55:02Z"), "2026-07-27T20:55:02Z");
  assert.equal(spannerValueOf(64906.5), 64906.5);
});

test("Spanner metrics also decode protobuf-style values", () => {
  assert.equal(spannerValueOf({ timestampValue: "2026-07-27T20:55:02Z" }), "2026-07-27T20:55:02Z");
  assert.equal(spannerValueOf({ numberValue: 64906.5 }), 64906.5);
  assert.equal(spannerValueOf({ nullValue: null }), null);
});

test("Spanner REST rows are positional arrays", () => {
  const row = ["2026-07-27T20:55:02Z", 64906.5];
  assert.deepEqual({ observed_at: spannerValueOf(row[0]), mid: spannerValueOf(row[1]) }, {
    observed_at: "2026-07-27T20:55:02Z",
    mid: 64906.5,
  });
});
