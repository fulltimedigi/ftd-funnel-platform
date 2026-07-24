/**
 * tests/budget-boundary.test.mjs — the canonical budget cut is boundary-consistent (ADR-0037 FIX-4).
 * ONE numeric cut drives the predicate (tierOf), the label, and the disclosure. A product priced at
 * boundary-ε / boundary / boundary+ε must land in the tier whose LABEL truthfully includes its price
 * — never EXACT against a displayed number it does not actually satisfy.
 */
import assert from "node:assert/strict";
import { tierOf, deriveBudgetAxis, productBudget } from "../authoring/author/budgetAxis.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

// 12 prices → tertile cuts. Use spread values so cutpoints are well-defined.
const prices = [50, 90, 140, 200, 300, 450, 600, 900, 1300, 1900, 2600, 4000];
const products = prices.map((price, i) => ({ name: `P${i}`, url: `https://b.example/p/${i}`, price }));

check("cutpoints are a single canonical numeric source", () => {
  const axis = deriveBudgetAxis(products);
  assert.ok(axis && axis.cuts && axis.cuts.length >= 1, "axis exposes canonical cuts");
});

check("boundary rule: price AT a cut belongs to the UPPER tier (inclusive-low), consistently", () => {
  const axis = deriveBudgetAxis(products);
  const cuts = axis.cuts;
  for (const c of cuts) {
    const eps = 0.01;
    const below = tierOf(c - eps, cuts);
    const at = tierOf(c, cuts);
    const above = tierOf(c + eps, cuts);
    assert.equal(at, below + 1, `price at cut ${c} must step up exactly one tier vs just-below`);
    assert.equal(above, at, `price just above cut ${c} stays in the same (upper) tier as the cut`);
  }
});

check("no product is EXACT against a label whose numeric boundary its price violates", () => {
  const axis = deriveBudgetAxis(products);
  const cuts = axis.cuts, nT = cuts.length + 1;
  const labelOf = (t) => (axis.values.find((v) => v.value === String(t)) || {}).label || "";
  for (const p of products) {
    const t = Number(productBudget(p, cuts));
    const label = labelOf(t);
    const price = p.price;
    if (t === 0) assert.ok(price < cuts[0], `${price} labelled "${label}" but not < ${cuts[0]}`);
    else if (t === nT - 1) assert.ok(price >= cuts[t - 1], `${price} labelled "${label}" (X فأكثر) but < ${cuts[t - 1]}`);
    else assert.ok(price >= cuts[t - 1] && price < cuts[t], `${price} labelled "${label}" but outside [${cuts[t - 1]}, ${cuts[t]})`);
  }
});

check("the top tier label is INCLUSIVE (فأكثر), so a price exactly at the last cut reads truthfully", () => {
  const axis = deriveBudgetAxis(products);
  const cuts = axis.cuts, top = cuts.length;
  const atCut = { name: "AtCut", url: "https://b.example/atcut", price: cuts[cuts.length - 1] };
  assert.equal(Number(productBudget(atCut, cuts)), top, "a price at the last cut is in the top tier");
  const topLabel = (axis.values.find((v) => v.value === String(top)) || {}).label || "";
  assert.ok(/فأكثر/.test(topLabel), `top label "${topLabel}" must be inclusive (فأكثر), not "أكثر من"`);
});

if (process.exitCode === 1) console.error("\nFAIL — budget boundary is inconsistent.\n");
else console.log(`\nPASS — all ${passed} budget-boundary assertions passed.\n`);
