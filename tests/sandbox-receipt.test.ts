import assert from "node:assert/strict";
import test from "node:test";
import { receiptForPlan, sandboxReceiptSummary, type SandboxReceipt } from "../src/sandbox.js";

test("sandbox receipt listings remove bearer session fragments and stray helper fields", () => {
  const receipt = {
    checkoutId: "checkout-sim-1",
    planId: "plan-1",
    stackId: "sim-1",
    createdAt: "2026-08-03T00:00:00.000Z",
    dashboardUrl: "https://preview.example/v3-demo?stack=sim-1#session=secret",
    status: "checkout",
    paymentStatus: "not_authorized",
    trace: [],
    event: "status_observed",
    detail: "must not escape",
  } as SandboxReceipt & { event: string; detail: string };

  assert.deepEqual(sandboxReceiptSummary(receipt), {
    checkoutId: "checkout-sim-1",
    planId: "plan-1",
    stackId: "sim-1",
    createdAt: "2026-08-03T00:00:00.000Z",
    dashboardUrl: "https://preview.example/v3-demo?stack=sim-1",
    status: "checkout",
    paymentStatus: "not_authorized",
    trace: [],
  });
});

test("a sandbox plan resolves to at most its first existing checkout", () => {
  const first = { checkoutId: "checkout-1", planId: "plan-1", stackId: "sim-1", createdAt: "2026-08-03T00:00:00.000Z", trace: [] } satisfies SandboxReceipt;
  const duplicate = { checkoutId: "checkout-2", planId: "plan-1", stackId: "sim-2", createdAt: "2026-08-03T00:01:00.000Z", trace: [] } satisfies SandboxReceipt;
  assert.equal(receiptForPlan([first, duplicate], "plan-1")?.checkoutId, "checkout-1");
  assert.equal(receiptForPlan([first], "missing"), null);
});
