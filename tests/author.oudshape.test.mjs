/**
 * tests/author.oudshape.test.mjs — Name-mined axes on an oud-shaped catalog (ADR-0018).
 *
 * The live oudfactory proof exposed a real limit: when a catalog's richness lives
 * in product NAMES (form/origin/size) and the structured type is coarse, only price
 * discriminated → dominant → the anti-bland gate (rightly) refused. This proves the
 * fix: co-occurrence clustering mines ≥2 mutually-exclusive fact axes from the names,
 * a non-product (Gift Card) is cleaned out, and the funnel passes ALL THREE gates.
 *
 * SYNTHETIC fixture (tests/fixtures/oud-shaped.synthetic.json) — no real client data.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { authorFunnel } = await import("../authoring/author/index.js");
const { deriveAxes, cleanCatalog } = await import("../authoring/author/axes.js");
const { validateConfig, formatValidationErrors } = await import("../engine/validateConfig.js");
const { trustValidate } = await import("../engine/trustValidate.js");
const { antiBlandCheck, formatAntiBland } = await import("../authoring/author/qualityGate.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(__dirname, "../configs/_schema.json"), "utf8"));
const oud = JSON.parse(readFileSync(join(__dirname, "./fixtures/oud-shaped.synthetic.json"), "utf8"));

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

await (async () => {
  console.log("\ncleaning + axis mining:");
  await check("non-products (Gift Card) are cleaned out before deriving", () => {
    const cleaned = cleanCatalog(oud.products);
    assert.equal(cleaned.length, oud.products.length - 1);
    assert.ok(!cleaned.some((p) => /gift/i.test(p.name)));
  });
  await check("≥2 mutually-exclusive facet axes are mined from the product names", () => {
    const d = deriveAxes({ products: cleanCatalog(oud.products) });
    const facetAxes = d.axes.filter((a) => String(a.id).startsWith("facet"));
    assert.ok(facetAxes.length >= 2, `expected ≥2 name-mined axes, got ${facetAxes.length}`);
    // within an axis, values are alternatives (a product carries at most one)
    for (const ax of facetAxes) assert.ok(ax.values.length >= 2);
  });

  console.log("\nauthoring an oud-shaped catalog:");
  const res = authorFunnel(oud, { brandName: "OudShop" });
  await check("authoring SUCCEEDS (≥2 fact axes) where before it refused", () => {
    assert.equal(res.ok, true, JSON.stringify(res.meta));
    assert.ok(res.meta.axes.length >= 2);
  });
  await check("the funnel passes schema + trust + ANTI-BLAND", () => {
    assert.ok(validateConfig(res.config, schema).valid, formatValidationErrors(validateConfig(res.config, schema)));
    assert.equal(trustValidate(res.config).ok, true);
    const ab = antiBlandCheck(res.config);
    assert.equal(ab.ok, true, formatAntiBland(ab));
  });
  await check("no result recommends the Gift Card; every result is a real product", () => {
    for (const a of res.config.archetypes) {
      assert.ok(!/gift-card/.test(a.recommendations.primary.url), "gift card must not be a result");
      assert.ok(/^https:\/\/oud-shop\.example\/products\//.test(a.recommendations.primary.url));
    }
  });
  await check("questions ask facts and the result derives from ≥2 combined signals", () => {
    assert.ok(res.config.derivedSignals.length >= 2);
    assert.ok(res.config.questions.every((q) => !/gift|which product|أي منتج/i.test(q.text)));
  });

  console.log("\nhonest fallback (no fabrication) when names carry no richness:");
  await check("a coarse catalog with only price varying is refused (no bland funnel)", () => {
    const flat = { origin: "https://x.example", products: Array.from({ length: 8 }, (_, i) => ({
      name: `Perfume ${i}`, url: `https://x.example/products/p${i}`, price: 50 + i * 20, currency: "USD", attributes: { type: "Perfume" }, differentiators: [],
    })) };
    const r = authorFunnel(flat, { brandName: "Flat" });
    assert.equal(r.ok, false, "only-price → dominant → must refuse honestly");
    assert.ok(["no-nonbland-funnel", "not-enough-fact-axes"].includes(r.reason), r.reason);
  });

  if (process.exitCode === 1) console.error("\nFAIL — oud-shape tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} oud-shape assertions passed.\n`);
})();
