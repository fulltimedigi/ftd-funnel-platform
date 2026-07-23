/**
 * tests/author.e2e.test.mjs — End-to-end: brand URL → funnel config (Stage 1+2).
 *
 * Composes the whole chain offline: a fake Shopify store (fetch injected) →
 * ingest → author → schema + trust gates. Proves the one-command promise
 * (paste a URL, get a gate-passing funnel of real products) without a network.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { generateFunnelFromUrl } = await import("../authoring/index.js");
const { validateConfig, formatValidationErrors } = await import("../engine/validateConfig.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(__dirname, "../configs/_schema.json"), "utf8"));

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

const SHOPIFY = JSON.stringify({ products: [
  { id: 1, title: "Hindi Oud Oil", handle: "hindi-oil", vendor: "OudCo", product_type: "Oud Oil", tags: ["hindi"], images: [{ src: "https://i/1" }], variants: [{ price: "120.00", sku: "HO1" }] },
  { id: 2, title: "Cambodi Oud Oil", handle: "cambodi-oil", vendor: "OudCo", product_type: "Oud Oil", tags: ["cambodi"], images: [{ src: "https://i/2" }], variants: [{ price: "200.00" }] },
  { id: 3, title: "Hindi Wood Chips", handle: "hindi-wood", vendor: "OudCo", product_type: "Wood", tags: ["hindi"], variants: [{ price: "90.00" }] },
  { id: 4, title: "Cambodi Wood Box", handle: "cambodi-wood", vendor: "OudCo", product_type: "Wood", tags: ["cambodi"], variants: [{ price: "800.00" }] },
  { id: 5, title: "Bakhoor Premium", handle: "bakhoor", vendor: "OudCo", product_type: "Bakhoor", tags: [], variants: [{ price: "45.00" }] },
  { id: 6, title: "Muattar Bakhoor", handle: "muattar", vendor: "OudCo", product_type: "Bakhoor", tags: [], variants: [{ price: "60.00" }] },
] });

function router(routes) {
  return async (url) => {
    const r = routes[url];
    if (!r) return { ok: false, status: 404, url, headers: { get: () => "" }, text: async () => "404" };
    const status = r.status || 200;
    return { ok: status < 400, status, url, headers: { get: () => r.ct || "text/html" }, text: async () => r.body };
  };
}
const ORIGIN = "https://oudco.example";
const routes = {
  [`${ORIGIN}/robots.txt`]: { body: "User-agent: *\nAllow: /" },
  [`${ORIGIN}/products.json?limit=250&page=1`]: { body: SHOPIFY, ct: "application/json" },
  [`${ORIGIN}/`]: { body: "<html><body>home</body></html>" },
};
const OFFLINE = { authorized: true, sleep: async () => {}, now: () => 0, minDelayMs: 0 };

await (async () => {
  console.log("\nURL → funnel, one chain:");
  const res = await generateFunnelFromUrl(`${ORIGIN}/`, { ...OFFLINE, fetch: router(routes), brandName: "OudCo" });

  await check("ingest + author succeed; 6 real products → a fact-based decision funnel", () => {
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.catalog.products.length, 6);
    assert.equal(res.config.scoring.mode, "decision-table");
    assert.ok(res.meta.axes.length >= 2, "derives from ≥2 fact axes");
  });
  await check("the generated funnel passes the schema gate", () => {
    const vc = validateConfig(res.config, schema);
    assert.ok(vc.valid, formatValidationErrors(vc));
  });
  await check("the generated funnel passes the trust gate (zero blockers)", () => {
    assert.equal(res.trust.ok, true, JSON.stringify(res.trust.findings.filter((f) => f.severity === "blocker"), null, 2));
  });
  await check("the generated funnel passes the ANTI-BLAND gate", () => {
    assert.equal(res.bland.ok, true, JSON.stringify(res.bland.findings, null, 2));
  });
  await check("every result is a REAL ingested product URL (provenance end-to-end)", () => {
    const urls = new Set(res.catalog.products.map((p) => p.url));
    for (const a of res.config.archetypes) assert.ok(urls.has(a.recommendations.primary.url), `${a.id} not a catalog URL`);
  });

  console.log("\nhonest failures (no fabrication):");
  await check("unauthorized URL is refused at the ingest stage", async () => {
    const r = await generateFunnelFromUrl(`${ORIGIN}/`, { authorized: false, fetch: router(routes) });
    assert.equal(r.ok, false);
    assert.equal(r.stage, "ingest");
    assert.equal(r.reason, "not-authorized");
  });
  await check("a site with no products fails honestly at ingest (empty-catalog)", async () => {
    const bare = { [`${ORIGIN}/robots.txt`]: { status: 404, body: "no" }, [`${ORIGIN}/`]: { body: "<html>nothing</html>" }, [`${ORIGIN}/sitemap.xml`]: { status: 404, body: "no" } };
    const r = await generateFunnelFromUrl(`${ORIGIN}/`, { ...OFFLINE, fetch: router(bare) });
    assert.equal(r.ok, false);
    assert.equal(r.stage, "ingest");
    assert.equal(r.reason, "empty-catalog");
  });

  if (process.exitCode === 1) console.error("\nFAIL — e2e authoring tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} e2e authoring assertions passed.\n`);
})();
