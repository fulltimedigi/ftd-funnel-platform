/**
 * tests/coverage.test.mjs — covering assignment: every product reachable (ADR-0031).
 * "Results First, Questions Last." Proves, on a synthetic catalog:
 *  • distinct profiles → ~100% of products are reachable (each owns its answer path),
 *  • a genuine profile-twin is recovered as a real nearest ALTERNATE (contextual),
 *  • the raised coverage gate actually FAILS a funnel that orphans most of the catalog
 *    (a gate that can't fail is theater).
 * No network, no model — axes are supplied directly to authorFromAxes.
 */

import assert from "node:assert/strict";
import { authorFromAxes } from "../authoring/author/index.js";
import { richnessCheck } from "../authoring/quality/richnessCheck.js";

const O = "https://brand.example";
const cartesian = (arrs) => arrs.reduce((acc, arr) => acc.flatMap((a) => arr.map((b) => [...a, b])), [[]]);
const range = (n) => Array.from({ length: n }, (_, i) => i);

/** Distinct real product URLs reachable across a config (primary + contextual). */
function reachableUrls(config) {
  const urls = new Set();
  for (const a of config.archetypes || []) {
    const r = a.recommendations || {};
    if (r.primary && r.primary.url) urls.add(r.primary.url);
    for (const c of r.contextual || []) if (c && c.url) urls.add(c.url);
  }
  return urls;
}

/** Build N products + 4 axes; product i gets the i-th combo as its profile (distinct),
 *  unless `collideLast` makes the last product a twin of product 0. */
function fixture(N, sizes = [3, 2, 2, 2], collideLast = false) {
  const products = range(N).map((i) => ({ name: "P" + i, url: `${O}/p/${i}`, price: 10 + i, currency: "USD" }));
  const combos = cartesian(sizes.map((s) => range(s).map(String))); // sizes multiply to N
  const comboOf = (i) => (collideLast && i === N - 1 ? combos[0] : combos[i]);
  const axes = sizes.map((sz, ax) => {
    const profile = new Map();
    products.forEach((p, i) => profile.set(p.url, comboOf(i)[ax]));
    return { id: "ax" + ax, label: "محور" + ax, question: "سؤال" + ax + "؟", values: range(sz).map((v) => ({ value: String(v), label: `a${ax}v${v}` })), profile };
  });
  return { catalog: { origin: O, products, brandUrl: O }, axes };
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

await (async () => {
  console.log("\ncovering assignment — full catalog coverage:");
  await check("24 distinct-profile products → ALL 24 reachable (~100% coverage)", () => {
    const { catalog, axes } = fixture(24);
    const r = authorFromAxes(catalog, axes, { maxQuestions: 4, maxCombos: 400 });
    assert.equal(r.ok, true, r.reason);
    const reach = reachableUrls(r.config);
    assert.equal(reach.size, 24, `expected all 24 reachable, got ${reach.size}`);
    const rich = richnessCheck(r.config, catalog);
    assert.equal(rich.ok, true, JSON.stringify(rich.findings));
    assert.ok(rich.metrics.coverage >= 0.95, `coverage ${rich.metrics.coverage}`);
  });

  await check("every product is the #1 (primary) for at least its own profile path", () => {
    const { catalog, axes } = fixture(24);
    const r = authorFromAxes(catalog, axes, { maxQuestions: 4, maxCombos: 400 });
    const primaries = new Set((r.config.archetypes || []).map((a) => a.recommendations.primary.url));
    // distinct profiles → each product owns its combo as PRIMARY (not merely an alternate)
    assert.equal(primaries.size, 24, `expected 24 distinct primaries, got ${primaries.size}`);
  });

  await check("a genuine profile-TWIN is recovered as a real nearest ALTERNATE (contextual)", () => {
    const { catalog, axes } = fixture(24, [3, 2, 2, 2], /*collideLast*/ true);
    const r = authorFromAxes(catalog, axes, { maxQuestions: 4, maxCombos: 400 });
    assert.equal(r.ok, true, r.reason);
    const reach = reachableUrls(r.config);
    assert.ok(reach.has(`${O}/p/23`), "the twin (p/23) is still reachable as an alternate");
    // it is NOT a primary (its twin p/0 owns the combo) but appears in some contextual list
    const asContextual = (r.config.archetypes || []).some((a) => (a.recommendations.contextual || []).some((c) => c.url === `${O}/p/23`));
    assert.ok(asContextual, "twin appears as a contextual alternate");
    assert.equal(reach.size, 24, "coverage stays ~100% via the ranked-alternate leaf");
  });

  console.log("\ncoverage gate — a gate that can't fail is theater:");
  await check("a funnel that orphans most of the catalog FAILS the coverage gate", () => {
    // 30-product catalog, but a config that only surfaces 3 → 10% coverage.
    const products = range(30).map((i) => ({ name: "P" + i, url: `${O}/p/${i}`, price: 10 + i }));
    const config = {
      questions: [{ id: "q1" }, { id: "q2" }, { id: "q3" }, { id: "q4" }],
      archetypes: [0, 1, 2].map((i) => ({ id: "R" + i, recommendations: { primary: { url: `${O}/p/${i}` } } })),
    };
    const rich = richnessCheck(config, { products });
    assert.equal(rich.ok, false, "must reject a catalog-orphaning funnel");
    assert.ok(rich.findings.some((f) => f.code === "RICHNESS_LOW_COVERAGE"), JSON.stringify(rich.findings));
  });

  await check("the gate still PASSES a near-fully-covering funnel", () => {
    const products = range(20).map((i) => ({ name: "P" + i, url: `${O}/p/${i}` }));
    const config = {
      questions: [{ id: "q1" }, { id: "q2" }, { id: "q3" }, { id: "q4" }],
      archetypes: range(19).map((i) => ({ id: "R" + i, recommendations: { primary: { url: `${O}/p/${i}` } } })),
    };
    const rich = richnessCheck(config, { products });
    assert.equal(rich.ok, true, JSON.stringify(rich.findings)); // 19/20 = 95% ≥ 90%
  });

  if (process.exitCode === 1) console.error("\nFAIL — coverage tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} coverage assertions passed.\n`);
})();
