import assert from "node:assert/strict";
import test from "node:test";
import { boundedFetch } from "../src/network.js";

test("network failures tell sandboxed agents how to recover", async () => {
  const failingFetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  await assert.rejects(
    boundedFetch("https://example.invalid/test", {}, 50, failingFetch),
    /example\.invalid failed: fetch failed.*enable outbound network access/i,
  );
});

test("network requests have a bounded timeout", async () => {
  const keepAlive = setInterval(() => undefined, 50);
  const hangingFetch = ((_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
  try {
    await assert.rejects(
      boundedFetch("https://example.invalid/test", {}, 5, hangingFetch),
      /Network request to example\.invalid failed:.*enable outbound network access/i,
    );
  } finally {
    clearInterval(keepAlive);
  }
});
