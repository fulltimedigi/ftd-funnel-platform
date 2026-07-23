/**
 * tests/jobs.test.mjs — async generation job core (ADR-0029).
 * Submit → background-run → poll, with a per-store design cache. Store + generate
 * injected (Map-backed fake), so no Netlify and no network. Covers cache hit,
 * pending+trigger, run persistence, honest fallback, regenerate.
 */

import assert from "node:assert/strict";
import { keyFor, submitJob, statusJob, runJob, recordFrom } from "../platform/jobs/generateJob.js";

/* Map-backed fake Blobs store. */
function fakeStore() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async set(k, v) { m.set(k, v); } };
}
const GREEN = { ok: true, findings: [] };
const okResult = (source = "ai", questions = 5) => ({
  ok: true, source,
  config: { id: "f", questions: Array.from({ length: questions }, (_, i) => ({ id: "q" + i })), archetypes: [] },
  trust: GREEN, bland: GREEN, richness: { ok: source === "ai", metrics: { questions } },
  catalog: { origin: "https://s", products: [1, 2, 3] },
  ai: source === "deterministic" ? { attempted: true, enrichOk: false, reason: "model-error" } : { attempted: true, accepted: true },
});

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

await (async () => {
  console.log("\njob key:");
  await check("same store → same key (normalized); different store → different key", () => {
    assert.equal(keyFor("Brand.com"), keyFor("https://brand.com/"));
    assert.notEqual(keyFor("a.com"), keyFor("b.com"));
    assert.match(keyFor("a.com"), /^[0-9a-f]{32}$/);
  });

  console.log("\nsubmit:");
  await check("invalid url → honest reject", async () => {
    const r = await submitJob({ url: "nope", store: fakeStore(), trigger: async () => {} });
    assert.equal(r.ok, false); assert.equal(r.reason, "invalid-url");
  });
  await check("fresh url → pending, marks the store, and TRIGGERS the background job", async () => {
    const store = fakeStore(); let triggered = null;
    const r = await submitJob({ url: "brand.com", store, trigger: async (id, url) => { triggered = { id, url }; } });
    assert.equal(r.status, "pending");
    assert.equal(store.m.get(r.id).status, "pending");
    assert.equal(triggered.id, r.id, "background triggered with the job id");
  });
  await check("CACHE HIT: an already-ready store returns instantly and does NOT re-trigger", async () => {
    const store = fakeStore(); const id = keyFor("brand.com");
    store.m.set(id, { status: "ready", config: { id: "f" } });
    let triggered = false;
    const r = await submitJob({ url: "brand.com", store, trigger: async () => { triggered = true; } });
    assert.equal(r.status, "ready"); assert.equal(r.cached, true);
    assert.equal(triggered, false, "no re-generation on a cache hit");
  });
  await check("regenerate:true bypasses the cache and re-runs", async () => {
    const store = fakeStore(); const id = keyFor("brand.com");
    store.m.set(id, { status: "ready", config: { id: "old" } });
    let triggered = false;
    const r = await submitJob({ url: "brand.com", regenerate: true, store, trigger: async () => { triggered = true; } });
    assert.equal(r.status, "pending"); assert.equal(triggered, true);
  });

  console.log("\nrun + status:");
  await check("runJob persists a READY record (config + gates + ai) for the poller", async () => {
    const store = fakeStore(); const id = "k1";
    await runJob({ id, url: "brand.com", store, generate: async () => okResult("ai", 5) });
    const rec = await statusJob({ id, store });
    assert.equal(rec.status, "ready");
    assert.equal(rec.source, "ai");
    assert.equal(rec.config.questions.length, 5);
    assert.equal(rec.catalog.count, 3);
  });
  await check("honest fallback: deterministic result stored with the REAL ai.reason (never fake-rich)", async () => {
    const store = fakeStore(); const id = "k2";
    await runJob({ id, url: "brand.com", store, generate: async () => okResult("deterministic", 2) });
    const rec = await statusJob({ id, store });
    assert.equal(rec.status, "ready");
    assert.equal(rec.source, "deterministic");
    assert.equal(rec.ai.reason, "model-error", "the real AI failure reason is preserved");
  });
  await check("a failed generation stores an ERROR record", async () => {
    const store = fakeStore(); const id = "k3";
    await runJob({ id, url: "brand.com", store, generate: async () => ({ ok: false, stage: "ingest", reason: "empty-catalog" }) });
    const rec = await statusJob({ id, store });
    assert.equal(rec.status, "error"); assert.equal(rec.reason, "empty-catalog");
  });
  await check("a THROWING generation is caught → error record (never a stuck pending)", async () => {
    const store = fakeStore(); const id = "k4";
    await runJob({ id, url: "brand.com", store, generate: async () => { throw new Error("boom"); } });
    const rec = await statusJob({ id, store });
    assert.equal(rec.status, "error"); assert.equal(rec.reason, "threw");
  });
  await check("unknown id → {status:'unknown'} (not a crash)", async () => {
    const rec = await statusJob({ id: "nope", store: fakeStore() });
    assert.equal(rec.status, "unknown");
  });

  console.log("\nend-to-end (submit → background run → poll):");
  await check("pending then ready, keyed by the same url-hash (the design cache)", async () => {
    const store = fakeStore();
    const sub = await submitJob({ url: "brand.com", store, trigger: async (id, url) => { await runJob({ id, url, store, generate: async () => okResult("ai", 6) }); } });
    assert.equal(sub.status, "pending");
    const rec = await statusJob({ id: sub.id, store });
    assert.equal(rec.status, "ready");
    assert.equal(rec.config.questions.length, 6);
    // a second submit for the same url is now an instant cache hit
    const again = await submitJob({ url: "brand.com", store, trigger: async () => { throw new Error("should not run"); } });
    assert.equal(again.cached, true);
  });

  console.log("\nrecordFrom:");
  await check("shapes ready/error records", () => {
    assert.equal(recordFrom(okResult("ai", 4), "u").status, "ready");
    assert.equal(recordFrom({ ok: false, stage: "author", reason: "x" }, "u").status, "error");
  });

  if (process.exitCode === 1) console.error("\nFAIL — jobs tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} job assertions passed.\n`);
})();
