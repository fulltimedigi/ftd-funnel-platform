/**
 * tests/richness.test.mjs — the "too thin" gate, REDEFINED to differentiating density (ADR-0037).
 * Teeth: thin-on-DENSE MUST fail, rich MUST pass, thin-on-NARROW (few grounded profiles) MUST pass —
 * even with many products. Depth is justified by distinct grounded profiles, not raw product count.
 */

import assert from "node:assert/strict";
import { richnessCheck, RICHNESS_DEFAULTS } from "../authoring/quality/richnessCheck.js";
import { differentiatingDensity } from "../authoring/quality/depthCalibration.js";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

// BARE catalog: names/urls only → ZERO grounded differentiating profiles (dense-narrow when large).
const bareCatalog = (n) => ({ products: Array.from({ length: n }, (_, i) => ({ name: "P" + i, url: "https://s/p/" + i })) });
// DENSE catalog: real type × price-band × differentiator → many distinct grounded profiles.
const denseCatalog = (n) => ({ products: Array.from({ length: n }, (_, i) => ({
  name: "P" + i, url: "https://s/p/" + i, price: 40 + i * 37,
  attributes: { type: ["alpha", "beta", "gamma", "delta"][i % 4] }, differentiators: [["x", "y", "z", "w", "v"][i % 5]],
})) });
function cfg(q, urls) {
  return {
    questions: Array.from({ length: q }, (_, i) => ({ id: "q" + i })),
    archetypes: urls.map((u) => ({ id: "R", recommendations: { primary: { name: "P", url: u } } })),
  };
}
const urls = (n) => Array.from({ length: n }, (_, i) => "https://s/p/" + i);

console.log("\nrichness gate (differentiating density):");

check("THIN on a DENSE catalog is REJECTED (2 Q, low coverage, many distinct profiles)", () => {
  const cat = denseCatalog(51);
  assert.ok(differentiatingDensity(cat) >= RICHNESS_DEFAULTS.richDensityMin, "the dense catalog is above the density floor");
  const r = richnessCheck(cfg(2, urls(6)), cat);
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === "RICHNESS_THIN_QUESTIONS"));
  assert.ok(r.findings.some((f) => f.code === "RICHNESS_LOW_COVERAGE"));
});

check("RICH funnel PASSES (5 Q, near-full coverage on a dense catalog)", () => {
  const r = richnessCheck(cfg(5, urls(48)), denseCatalog(51));
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.ok(r.metrics.coverage >= 0.9, `coverage ${r.metrics.coverage}`);
});

check("a MID-coverage funnel (59%) on a dense catalog is REJECTED (coverage floor)", () => {
  const r = richnessCheck(cfg(6, urls(30)), denseCatalog(51)); // 30/51 = 59%
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === "RICHNESS_LOW_COVERAGE"));
});

check("DENSE-NARROW: many products but FEW grounded profiles → THIN funnel PASSES (the ADR-0037 fix)", () => {
  // 51 bare products (0 distinct grounded profiles) — the old count gate forced ≥4 Q; density does not.
  const cat = bareCatalog(51);
  assert.equal(differentiatingDensity(cat), 0, "bare products carry no differentiating data");
  const r = richnessCheck(cfg(2, urls(51)), cat);
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.equal(r.metrics.catalogJustifiesDepth, false);
});

check("THIN on a SMALL catalog PASSES (honest floor — never pad questions)", () => {
  const r = richnessCheck(cfg(2, urls(4)), bareCatalog(6));
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.equal(r.metrics.catalogJustifiesDepth, false);
});

check("enough questions but LOW coverage on a dense catalog is REJECTED", () => {
  const r = richnessCheck(cfg(5, urls(4)), denseCatalog(40));
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === "RICHNESS_LOW_COVERAGE"));
  assert.ok(!r.findings.some((f) => f.code === "RICHNESS_THIN_QUESTIONS"));
});

check("CAUSALITY — same product COUNT, different profile DENSITY → different decision", () => {
  const dense = denseCatalog(20);
  const narrow = { products: Array.from({ length: 20 }, (_, i) => ({ name: "P" + i, url: "https://s/p/" + i, price: 100, attributes: { type: "same" }, differentiators: ["same"] })) }; // 1 profile
  assert.ok(differentiatingDensity(dense) >= RICHNESS_DEFAULTS.richDensityMin, "dense is above floor");
  assert.ok(differentiatingDensity(narrow) < RICHNESS_DEFAULTS.richDensityMin, "narrow is below floor");
  const shallow = cfg(2, urls(20));
  const rDense = richnessCheck(shallow, dense);
  const rNarrow = richnessCheck(shallow, narrow);
  assert.equal(rDense.ok, false, "shallow funnel on the DENSE catalog fails (justifies depth)");
  assert.equal(rNarrow.ok, true, "SAME shallow funnel on the NARROW catalog passes (does not justify depth)");
  assert.equal(rDense.metrics.products, rNarrow.metrics.products, "identical product counts, opposite verdicts → it's density, not count");
});

check("DENSITY bands raw price (12 distinct prices ≠ 12 profiles) and drops identity/UNKNOWN fields", () => {
  // 12 UNIQUE raw prices, same type+diff → collapse to the price BANDS (≤3), never 12 per-product profiles.
  const priced = { products: Array.from({ length: 12 }, (_, i) => ({ name: "SKU-" + i, url: "https://s/p/" + i, price: 100 + i, attributes: { type: "oud" }, differentiators: ["woody"] })) };
  const d = differentiatingDensity(priced);
  assert.ok(d >= 1 && d <= 3, `raw price must be banded, got ${d} profiles`);
  assert.ok(d < 12, "12 distinct raw prices must NOT look like 12 distinct profiles (the false-density trap)");
  assert.equal(differentiatingDensity(bareCatalog(30)), 0, "products with no grounded fields add 0 (UNKNOWN not counted)");
});

check("coverage counts contextual recommendations too, de-duplicated", () => {
  const config = {
    questions: [1, 2, 3, 4].map((i) => ({ id: "q" + i })),
    archetypes: [
      { recommendations: { primary: { url: "u1" }, contextual: [{ url: "u2" }, { url: "u3" }] } },
      { recommendations: { primary: { url: "u1" }, contextual: [{ url: "u4" }] } },
    ],
  };
  const r = richnessCheck(config, bareCatalog(12));
  assert.equal(r.metrics.reachable, 4);
});

if (process.exitCode === 1) console.error("\nFAIL — richness tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} richness assertions passed.\n`);
