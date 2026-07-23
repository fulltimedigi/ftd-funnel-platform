/**
 * tests/blobstore.test.mjs — Netlify Blobs adapter selection + health (ADR-0030).
 * `getStore` is INJECTED (deps._getStore), so no @netlify/blobs and no network.
 * Proves: manual config (siteID+token) is preferred when a token is present, auto
 * fallback otherwise, and healthy() honestly reports an unconfigured store.
 */

import assert from "node:assert/strict";
import { pickStoreArgs, createBlobStore } from "../platform/jobs/blobStore.js";

/* A getStore() that succeeds — Map-backed, records how it was configured. */
function fakeGetStore(sink) {
  return (args) => {
    sink.args = args;
    const m = new Map();
    return {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async setJSON(k, v) { m.set(k, v); },
    };
  };
}
/* A getStore() whose ops throw — mimics MissingBlobsEnvironmentError. */
function throwingGetStore(args) {
  return {
    async get() { const e = new Error("no blobs"); e.name = "MissingBlobsEnvironmentError"; throw e; },
    async setJSON() { const e = new Error("no blobs"); e.name = "MissingBlobsEnvironmentError"; throw e; },
  };
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

await (async () => {
  console.log("\npickStoreArgs:");
  await check("token + siteID → MANUAL config object", () => {
    const a = pickStoreArgs("ftd", { NETLIFY_BLOBS_TOKEN: "t", SITE_ID: "s" });
    assert.deepEqual(a, { name: "ftd", siteID: "s", token: "t" });
  });
  await check("NETLIFY_API_TOKEN + NETLIFY_SITE_ID also work", () => {
    const a = pickStoreArgs("ftd", { NETLIFY_API_TOKEN: "t2", NETLIFY_SITE_ID: "s2" });
    assert.deepEqual(a, { name: "ftd", siteID: "s2", token: "t2" });
  });
  await check("no token → auto-context (bare name string)", () => {
    assert.equal(pickStoreArgs("ftd", { SITE_ID: "s" }), "ftd");
    assert.equal(pickStoreArgs("ftd", {}), "ftd");
  });

  console.log("\ncreateBlobStore selection:");
  await check("uses MANUAL config when a token is present", async () => {
    const sink = {};
    await createBlobStore("ftd-funnels", { _getStore: fakeGetStore(sink), env: { NETLIFY_BLOBS_TOKEN: "t", SITE_ID: "s" } });
    assert.deepEqual(sink.args, { name: "ftd-funnels", siteID: "s", token: "t" });
  });
  await check("uses auto-context (name) when no token", async () => {
    const sink = {};
    await createBlobStore("ftd-funnels", { _getStore: fakeGetStore(sink), env: {} });
    assert.equal(sink.args, "ftd-funnels");
  });

  console.log("\nget/set/healthy:");
  await check("round-trips get/set through the underlying store", async () => {
    const store = await createBlobStore("ftd", { _getStore: fakeGetStore({}), env: { NETLIFY_BLOBS_TOKEN: "t", SITE_ID: "s" } });
    await store.set("k", { a: 1 });
    assert.deepEqual(await store.get("k"), { a: 1 });
  });
  await check("healthy() TRUE when the store works", async () => {
    const store = await createBlobStore("ftd", { _getStore: fakeGetStore({}), env: {} });
    assert.equal(await store.healthy(), true);
  });
  await check("healthy() FALSE when the store is unconfigured (never throws)", async () => {
    const store = await createBlobStore("ftd", { _getStore: throwingGetStore, env: {} });
    assert.equal(await store.healthy(), false);
    // get also swallows to null rather than throwing — callers stay in control.
    assert.equal(await store.get("k"), null);
  });

  if (process.exitCode === 1) console.error("\nFAIL — blobstore tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} blobstore assertions passed.\n`);
})();
