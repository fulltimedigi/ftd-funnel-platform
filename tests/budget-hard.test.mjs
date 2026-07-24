/**
 * tests/budget-hard.test.mjs — the budget axis is a HARD (ordinal) constraint (ADR-0035).
 * Proves: for every decision rule the recommended product's real price tier == the chosen
 * tier WHENEVER that (form × tier) cell has products; where a cell is genuinely EMPTY
 * (e.g. no cheap perfume) the pick is the NEAREST tier OF THE SAME FORM — never across
 * form, never wildly off (no <500 → 4000). Coverage stays ~100%. No network/model.
 */

import assert from "node:assert/strict";
import { authorFromAxes } from "../authoring/author/index.js";
import { productFormat } from "../authoring/author/formatAxis.js";
import { deriveBudgetAxis, productBudget } from "../authoring/author/budgetAxis.js";

const O = "https://oud.example";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

// 12 products; prices chosen so perfume has NO low-tier item (an empty form×tier cell).
const DEF = [
  ["P1 Parfum", 600], ["P2 Parfum", 700], ["P3 Parfum", 1200], ["P4 Parfum", 1400],
  ["O1 Oud Oil", 100], ["O2 Oud Oil", 200], ["O3 Oud Oil", 800], ["O4 Oud Oil", 1300],
  ["R1 Agarwood", 150], ["R2 Agarwood", 250], ["R3 Agarwood", 300], ["R4 Agarwood", 1500],
];
const products = DEF.map(([name, price], i) => ({ name, url: `${O}/p/${i}`, price, currency: "SAR" }));
const character = (() => {
  const profile = new Map();
  products.forEach((p, i) => profile.set(p.url, i % 2 ? "fresh" : "woody"));
  return { id: "character", label: "الطابع", question: "؟", values: [{ value: "woody", label: "خشبي" }, { value: "fresh", label: "منعش" }], profile };
})();

const budgetAxis = deriveBudgetAxis(products);
const cuts = budgetAxis.cuts;
const tierOf = (p) => productBudget(p, cuts);
const prodByUrl = new Map(products.map((p) => [p.url, p]));

// which tiers each format actually populates (to know which cells are empty)
const occ = {};
for (const p of products) { const f = productFormat(p), t = tierOf(p); (occ[f] = occ[f] || new Set()).add(t); }
const nearestTiers = (f, want) => {
  const have = [...occ[f]];
  const min = Math.min(...have.map((t) => Math.abs(Number(t) - Number(want))));
  return new Set(have.filter((t) => Math.abs(Number(t) - Number(want)) === min));
};

check("deriveBudgetAxis makes an ordinal hard axis with real range labels", () => {
  assert.equal(budgetAxis.hard, true);
  assert.equal(budgetAxis.ordinal, true);
  assert.ok(budgetAxis.values.length >= 2);
  assert.match(budgetAxis.values[0].label, /أقل من|–|أكثر/); // a real range, not a vague word
});

check("ZERO budget leak for populated cells; empty cells fall to the NEAREST same-form tier", () => {
  const r = authorFromAxes({ origin: O, products, brandUrl: O }, [character], { maxQuestions: 4 });
  assert.equal(r.ok, true, r.reason);
  const cfg = r.config;
  const archById = new Map(cfg.archetypes.map((a) => [a.id, a]));
  let exactCells = 0, emptyCells = 0, formLeak = 0;
  for (const rule of cfg.decisionTable) {
    const wantF = rule.when && rule.when.D_format, wantB = rule.when && rule.when.D_budget;
    if (!wantF || wantB == null) continue;
    const prod = prodByUrl.get(archById.get(rule.result).recommendations.primary.url);
    const gotF = productFormat(prod), gotB = tierOf(prod);
    if (gotF !== wantF) formLeak++;
    if (occ[wantF] && occ[wantF].has(wantB)) { assert.equal(gotB, wantB, `populated cell (${wantF},${wantB}) must be exact, got tier ${gotB}`); exactCells++; }
    else { assert.ok(nearestTiers(wantF, wantB).has(gotB), `empty cell (${wantF},${wantB}) → nearest same-form tier, got ${gotB}`); emptyCells++; }
  }
  assert.equal(formLeak, 0, "never crosses form");
  assert.ok(exactCells >= 8, "most rules are exact-in-budget");
  assert.ok(emptyCells >= 1, "the empty perfume-low cell was exercised (nearest-tier fallback)");
});

check("the operator's disaster is gone: a low-budget path never returns a top-tier item across form", () => {
  const r = authorFromAxes({ origin: O, products, brandUrl: O }, [character], { maxQuestions: 4 });
  const archById = new Map(r.config.archetypes.map((a) => [a.id, a]));
  for (const rule of r.config.decisionTable) {
    const wantF = rule.when && rule.when.D_format, wantB = rule.when && rule.when.D_budget;
    if (!wantF || wantB == null) continue;
    const prod = prodByUrl.get(archById.get(rule.result).recommendations.primary.url);
    // never more than one tier away, and never a different form
    assert.equal(productFormat(prod), wantF);
    assert.ok(Math.abs(Number(tierOf(prod)) - Number(wantB)) <= 1, `tier gap ≤1 for (${wantF},${wantB})`);
  }
});

check("coverage stays ~100% under the form × budget partition", () => {
  const r = authorFromAxes({ origin: O, products, brandUrl: O }, [character], { maxQuestions: 4 });
  const reach = new Set();
  for (const a of r.config.archetypes) { reach.add(a.recommendations.primary.url); for (const c of a.recommendations.contextual || []) reach.add(c.url); }
  assert.equal(reach.size, products.length, `all ${products.length} reachable, got ${reach.size}`);
});

if (process.exitCode === 1) console.error("\nFAIL — budget-hard tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} budget-hard assertions passed.\n`);
