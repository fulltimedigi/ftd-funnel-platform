/**
 * tests/author.axes.test.mjs — Decision-axis derivation, algorithm unit tests (ADR-0014).
 *
 * Verifies the deterministic logic on a small SYNTHETIC catalog (test data, not
 * real products): entropy, tokenization, price-band axis, categorical (type)
 * axis, keyword facets, discrimination scoring, and dropping of non-discriminating
 * axes. The real-catalog behaviour is covered by tests/author.axes.oud.test.mjs.
 */

import assert from "node:assert/strict";

const { deriveAxes, entropy, tokenize, keywordFacets } = await import("../authoring/author/axes.js");

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

// Synthetic oud-shaped catalog (TEST DATA).
const CAT = { products: [
  { name: "Hindi Oud Oil 3ml", url: "https://s/products/hindi-oil", price: 120, attributes: { type: "Oud Oil" }, differentiators: ["hindi", "oil"] },
  { name: "Cambodi Oud Oil 3ml", url: "https://s/products/cambodi-oil", price: 200, attributes: { type: "Oud Oil" }, differentiators: ["cambodi", "oil"] },
  { name: "Hindi Wood Chips", url: "https://s/products/hindi-wood", price: 90, attributes: { type: "Wood" }, differentiators: ["hindi", "wood"] },
  { name: "Cambodi Wood Box 5 Tola", url: "https://s/products/cambodi-wood", price: 800, attributes: { type: "Wood" }, differentiators: ["cambodi", "wood", "tola"] },
  { name: "Bakhoor Premium", url: "https://s/products/bakhoor", price: 45, attributes: { type: "Bakhoor" }, differentiators: ["bakhoor"] },
  { name: "Muattar Bakhoor", url: "https://s/products/muattar", price: 60, attributes: { type: "Bakhoor" }, differentiators: ["bakhoor"] },
] };

await (async () => {
  console.log("\nmath + tokenize:");
  await check("entropy: even split → ~1, single value → 0", () => {
    assert.ok(Math.abs(entropy([3, 3]) - 1) < 1e-9);
    assert.equal(entropy([6]), 0);
    assert.equal(entropy([6, 0]), 0);
    assert.ok(entropy([4, 1, 1]) > 0 && entropy([4, 1, 1]) < 1);
  });
  await check("tokenize lowercases, strips punctuation, drops stopwords, keeps Arabic", () => {
    assert.deepEqual(tokenize("Hindi Oud Oil 3ml, Box of"), ["hindi", "oud", "oil", "3ml"]); // box/of/ml dropped
    assert.ok(tokenize("عود هندي").includes("هندي"));
  });

  console.log("\nprice-band axis:");
  await check("splits priced products into budget/mid/premium with real URLs", () => {
    const { axes } = deriveAxes(CAT);
    const price = axes.find((a) => a.id === "price");
    assert.ok(price, "price axis derived");
    assert.equal(price.coverage, 1); // all priced
    const budget = price.values.find((v) => v.value === "budget");
    assert.ok(budget.count >= 2);
    assert.ok(budget.productUrls.every((u) => u.startsWith("https://s/products/")), "real product URLs under the band");
    assert.ok(price.discrimination > 0);
  });

  console.log("\ncategorical (type) axis:");
  await check("derives product-type axis; 3 even types → high discrimination", () => {
    const { axes } = deriveAxes(CAT);
    const type = axes.find((a) => a.id === "type");
    assert.ok(type, "type axis derived");
    assert.equal(type.values.length, 3); // Oud Oil, Wood, Bakhoor
    assert.ok(type.discrimination > 0.9, "three groups of two split evenly");
    assert.equal(type.values.reduce((s, v) => s + v.count, 0), 6);
  });

  console.log("\nkeyword facets:");
  await check("keeps discriminating terms (df in band), drops one-offs; carries URLs", () => {
    const { facets } = deriveAxes(CAT);
    const terms = facets.map((f) => f.term);
    for (const t of ["hindi", "cambodi", "oil", "wood", "bakhoor"]) assert.ok(terms.includes(t), `expected facet ${t}`);
    assert.ok(!terms.includes("tola"), "df=1 term dropped");
    assert.ok(!terms.includes("muattar"), "df=1 term dropped");
    const hindi = facets.find((f) => f.term === "hindi");
    assert.equal(hindi.count, 2);
    assert.equal(hindi.productUrls.length, 2);
  });

  console.log("\ndiscrimination filtering (RULE 4 — no theater axis):");
  await check("a single-value attribute yields no axis", () => {
    const same = { products: CAT.products.map((p) => ({ ...p, attributes: { type: "Oud" }, brand: "OudFactory" })) };
    const { axes } = deriveAxes(same);
    assert.ok(!axes.find((a) => a.id === "type"), "one type → dropped");
    assert.ok(!axes.find((a) => a.id === "brand"), "one brand → dropped");
  });
  await check("axes are ranked by score (coverage × discrimination), deterministically", () => {
    const a1 = deriveAxes(CAT).axes.map((a) => a.id);
    const a2 = deriveAxes(CAT).axes.map((a) => a.id);
    assert.deepEqual(a1, a2, "stable order");
    const scores = deriveAxes(CAT).axes.map((a) => a.score);
    assert.deepEqual(scores, [...scores].sort((x, y) => y - x), "descending by score");
  });

  if (process.exitCode === 1) console.error("\nFAIL — axes unit tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} axes assertions passed.\n`);
})();
