/**
 * tests/netlify.generate.test.mjs — server-side generator function (ADR-0027).
 *
 * Exercises the Netlify Function handler directly (no Netlify needed): method +
 * CORS guards, URL validation, the authorized-sites-only scope, honest failure,
 * and a REAL success driven by an injected server-side fetch (proving the server
 * reads a catalog with no CORS limit). Exits non-zero on failure.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { handler } = await import("../netlify/functions/generate.mjs");

const __dirname = dirname(fileURLToPath(import.meta.url));
// Build the same JSON-LD sample catalog the sample shop serves (synthetic fixture).
const fx = JSON.parse(readFileSync(join(__dirname, "./fixtures/oud-shaped.synthetic.json"), "utf8"));
const base = "https://shop.example/p/";
const graph = fx.products.map((p, i) => ({ "@type": "Product", name: p.name, url: base + (i + 1), offers: { "@type": "Offer", price: p.price || 0, priceCurrency: p.currency || "USD", url: base + (i + 1) } }));
const SAMPLE_HTML = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</` + `script></head><body>shop</body></html>`;

const START = "https://shop.example/";
// A server-side fetch: returns the catalog HTML for the start page, 404 elsewhere.
// (The pipeline reads opts.fetch; a real Netlify runtime uses global fetch — no CORS.)
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u === START || u === START.replace(/\/$/, "")) return { ok: true, status: 200, text: async () => SAMPLE_HTML, headers: new Map() };
  return { ok: false, status: 404, text: async () => "", headers: new Map() };
};

const post = (body) => ({ httpMethod: "POST", body: JSON.stringify(body) });

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

await (async () => {
  console.log("\ngenerate function — guards:");
  await check("OPTIONS → 204 with CORS headers (preflight)", async () => {
    const r = await handler({ httpMethod: "OPTIONS" });
    assert.equal(r.statusCode, 204);
    assert.equal(r.headers["Access-Control-Allow-Origin"], "*");
  });
  await check("GET → 405 (POST only)", async () => {
    const r = await handler({ httpMethod: "GET" });
    assert.equal(r.statusCode, 405);
  });
  await check("junk url → 400 invalid-url", async () => {
    const r = await handler(post({ url: "not a url", authorized: true }));
    assert.equal(r.statusCode, 400);
    assert.equal(JSON.parse(r.body).reason, "invalid-url");
  });
  await check("missing authorization → 403 not-authorized (scope: authorized sites only)", async () => {
    const r = await handler(post({ url: START }));
    assert.equal(r.statusCode, 403);
    assert.equal(JSON.parse(r.body).reason, "not-authorized");
  });
  await check("bad JSON body → 400 bad-json", async () => {
    const r = await handler({ httpMethod: "POST", body: "{not json" });
    assert.equal(r.statusCode, 400);
    assert.equal(JSON.parse(r.body).reason, "bad-json");
  });

  console.log("\ngenerate function — real generation (server reads the catalog):");
  await check("valid authorized url → 200 with config + both gates green + product count", async () => {
    const r = await handler(post({ url: START, authorized: true }));
    assert.equal(r.statusCode, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.ok, true);
    assert.ok(j.config && j.config.questions.length >= 2, "a real funnel was authored");
    assert.equal(j.trust.ok, true);
    assert.equal(j.bland.ok, true);
    assert.ok(j.catalog.count >= 4, "reports the real product count read server-side");
    assert.ok(r.headers["Access-Control-Allow-Origin"], "CORS on the success response");
  });
  await check("a site with no catalog → 422 honest failure (never a fake success)", async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "<html><body>no products</body></html>", headers: new Map() });
    const r = await handler(post({ url: "https://empty.example/", authorized: true }));
    globalThis.fetch = prev;
    assert.equal(r.statusCode, 422);
    assert.equal(JSON.parse(r.body).ok, false);
  });

  if (process.exitCode === 1) console.error("\nFAIL — generate-function tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} generate-function assertions passed.\n`);
})();
