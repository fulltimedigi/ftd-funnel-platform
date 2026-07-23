/**
 * tests/functions.security.test.mjs — endpoint gating (ADR-0032).
 * Exercises the guard branches that run BEFORE the Blobs store (so no @netlify/blobs
 * dependency is loaded): tightened CORS (not "*"), the optional token gate, the
 * server-side SSRF re-check, and method guards. The retired sync endpoint is covered
 * in netlify.generate.test.mjs.
 */

import assert from "node:assert/strict";

const { handler: submit } = await import("../netlify/functions/generate-submit.mjs");
const { handler: status } = await import("../netlify/functions/generate-status.mjs");

const post = (body, headers = {}) => ({ httpMethod: "POST", headers, body: JSON.stringify(body) });

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

await (async () => {
  console.log("\nfunctions — CORS is first-party, not '*':");
  await check("submit OPTIONS → 204 with a specific allow-origin (never '*')", async () => {
    const r = await submit({ httpMethod: "OPTIONS", headers: {} });
    assert.equal(r.statusCode, 204);
    assert.notEqual(r.headers["Access-Control-Allow-Origin"], "*");
    assert.match(r.headers["Access-Control-Allow-Origin"], /^https:\/\//);
  });
  await check("an allow-listed Origin is echoed back", async () => {
    const r = await submit({ httpMethod: "OPTIONS", headers: { origin: "https://fulltimedigi.com" } });
    assert.equal(r.headers["Access-Control-Allow-Origin"], "https://fulltimedigi.com");
  });

  console.log("\nfunctions — method + auth gates (before any storage):");
  await check("submit GET → 405", async () => {
    assert.equal((await submit({ httpMethod: "GET", headers: {} })).statusCode, 405);
  });
  await check("submit without authorized:true → 403", async () => {
    const r = await submit(post({ url: "https://oud.example/" }));
    assert.equal(r.statusCode, 403);
    assert.equal(JSON.parse(r.body).reason, "not-authorized");
  });
  await check("SSRF: an authorized localhost URL is refused server-side (400 blocked-url)", async () => {
    const r = await submit(post({ url: "http://localhost:8000/", authorized: true }));
    assert.equal(r.statusCode, 400);
    assert.equal(JSON.parse(r.body).reason, "blocked-url");
  });

  console.log("\nfunctions — optional token gate (enforced only when configured):");
  await check("with FTD_PUBLIC_TOKEN set, a missing/wrong token → 401 (submit + status)", async () => {
    process.env.FTD_PUBLIC_TOKEN = "s3cret";
    try {
      assert.equal((await submit(post({ url: "https://oud.example/", authorized: true }))).statusCode, 401);
      assert.equal((await status({ httpMethod: "GET", headers: {}, queryStringParameters: { id: "x" } })).statusCode, 401);
      // correct token passes the gate (submit then proceeds to other checks, not 401)
      const ok = await submit(post({ url: "https://oud.example/" }, { "x-ftd-token": "s3cret" }));
      assert.notEqual(ok.statusCode, 401);
    } finally { delete process.env.FTD_PUBLIC_TOKEN; }
  });

  console.log("\nfunctions — status guards (before storage):");
  await check("status POST → 405; status GET without id → 400 missing-id", async () => {
    assert.equal((await status({ httpMethod: "POST", headers: {} })).statusCode, 405);
    const r = await status({ httpMethod: "GET", headers: {}, queryStringParameters: {} });
    assert.equal(r.statusCode, 400);
    assert.equal(JSON.parse(r.body).reason, "missing-id");
  });

  if (process.exitCode === 1) console.error("\nFAIL — functions-security tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} functions-security assertions passed.\n`);
})();
