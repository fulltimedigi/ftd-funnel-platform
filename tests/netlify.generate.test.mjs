/**
 * tests/netlify.generate.test.mjs — the RETIRED sync generator (ADR-0032).
 *
 * The sync endpoint 504'd after spending the API key, so it was retired in favour of
 * the async submit → background → poll flow. This asserts it now fails fast with 501
 * and points callers at the async endpoints — and, crucially, NEVER runs generation
 * (no fetch, no model spend). Real generation is covered by jobs/enrich/coverage suites.
 */

import assert from "node:assert/strict";

const { handler } = await import("../netlify/functions/generate.mjs");

// If the retired endpoint ever touched the network, this would throw — proving it doesn't.
globalThis.fetch = async () => { throw new Error("retired endpoint must not fetch"); };

const post = (body) => ({ httpMethod: "POST", body: JSON.stringify(body) });

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

await (async () => {
  console.log("\ngenerate function — retired (ADR-0032):");
  await check("OPTIONS → 204 (preflight still answered)", async () => {
    const r = await handler({ httpMethod: "OPTIONS" });
    assert.equal(r.statusCode, 204);
  });
  await check("POST → 501 endpoint-retired, points at the async flow, no model spend", async () => {
    const r = await handler(post({ url: "https://shop.example/", authorized: true }));
    assert.equal(r.statusCode, 501);
    const j = JSON.parse(r.body);
    assert.equal(j.ok, false);
    assert.equal(j.reason, "endpoint-retired");
    assert.match(j.use.submit, /generate-submit/);
    assert.match(j.use.status, /generate-status/);
  });
  await check("even a junk POST → 501 (fails fast, never authors)", async () => {
    const r = await handler({ httpMethod: "POST", body: "{not json" });
    assert.equal(r.statusCode, 501);
  });

  if (process.exitCode === 1) console.error("\nFAIL — generate-function tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} generate-function assertions passed.\n`);
})();
