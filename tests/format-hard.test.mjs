/**
 * tests/format-hard.test.mjs — the format axis is a HARD constraint (ADR-0034).
 * Proves ZERO cross-format leakage: for every decision rule, the recommended product's
 * real form == the rule's chosen form; a "spray" path yields only sprays, never a raw
 * oud or an oil. Coverage stays ~100% (achieved WITHIN each form). No network/model.
 */

import assert from "node:assert/strict";
import { authorFromAxes } from "../authoring/author/index.js";
import { productFormat, deriveFormatAxis } from "../authoring/author/formatAxis.js";

const O = "https://oud.example";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

/* A synthetic oud catalog with UNAMBIGUOUS forms in the names + soft axes (AI-supplied). */
const FORMS = [
  ["perfume", (i) => `Signature ${i} Parfum`],
  ["oil", (i) => `Signature ${i} Oud Oil`],
  ["raw", (i) => `Signature ${i} Agarwood`],
];
const products = [];
FORMS.forEach(([, name]) => { for (let i = 0; i < 4; i++) products.push({ name: name(products.length), url: `${O}/p/${products.length}`, price: 100 + products.length * 10 }); });
// soft axes the "AI" proposes: character + intensity, mapped for every product
const softAxis = (id, label, vals, fn) => {
  const profile = new Map();
  products.forEach((p, i) => profile.set(p.url, vals[fn(i)]));
  return { id, label, question: label + "؟", values: vals.map((v) => ({ value: v, label: v })), profile };
};
const AI_AXES = [
  softAxis("character", "الطابع", ["woody", "fresh"], (i) => i % 2),
  softAxis("intensity", "الثبات", ["soft", "strong"], (i) => (i >> 1) % 2),
];

const fmtOf = (url) => productFormat(products.find((p) => p.url === url));

check("deriveFormatAxis reads the real forms deterministically (perfume/oil/raw)", () => {
  const ax = deriveFormatAxis(products);
  assert.ok(ax && ax.hard === true, "format axis is hard");
  assert.deepEqual(ax.values.map((v) => v.value).sort(), ["oil", "perfume", "raw"]);
  assert.equal(ax.profile.get(`${O}/p/0`), "perfume");
  assert.equal(ax.profile.get(`${O}/p/4`), "oil");
  assert.equal(ax.profile.get(`${O}/p/8`), "raw");
});

check("ZERO cross-format leakage: every rule's result matches the rule's chosen form", () => {
  const r = authorFromAxes({ origin: O, products, brandUrl: O }, AI_AXES, { maxQuestions: 4 });
  assert.equal(r.ok, true, r.reason);
  const cfg = r.config;
  const archById = new Map(cfg.archetypes.map((a) => [a.id, a]));
  let checkedFormatRules = 0;
  for (const rule of cfg.decisionTable) {
    const want = rule.when && rule.when.D_format;
    if (!want) continue; // the default rule has no when
    const arch = archById.get(rule.result);
    assert.ok(arch, "rule resolves to a real archetype");
    const got = fmtOf(arch.recommendations.primary.url);
    assert.equal(got, want, `rule ${rule.id}: form ${got} must equal chosen ${want}`);
    checkedFormatRules++;
  }
  assert.ok(checkedFormatRules >= 8, "format rules were actually exercised");
});

check("a SPRAY path yields only sprays; a RAW path only raw (the operator's exact bug)", () => {
  const r = authorFromAxes({ origin: O, products, brandUrl: O }, AI_AXES, { maxQuestions: 4 });
  const cfg = r.config;
  const archById = new Map(cfg.archetypes.map((a) => [a.id, a]));
  const resultsFor = (form) => cfg.decisionTable
    .filter((rule) => rule.when && rule.when.D_format === form)
    .map((rule) => fmtOf(archById.get(rule.result).recommendations.primary.url));
  assert.ok(resultsFor("perfume").length > 0 && resultsFor("perfume").every((f) => f === "perfume"), "spray → only sprays");
  assert.ok(resultsFor("raw").every((f) => f === "raw"), "raw → only raw");
  assert.ok(resultsFor("oil").every((f) => f === "oil"), "oil → only oil");
});

check("coverage stays ~100% under the format partition (every product reachable)", () => {
  const r = authorFromAxes({ origin: O, products, brandUrl: O }, AI_AXES, { maxQuestions: 4 });
  const reach = new Set();
  for (const a of r.config.archetypes) {
    reach.add(a.recommendations.primary.url);
    for (const c of a.recommendations.contextual || []) reach.add(c.url);
  }
  assert.equal(reach.size, products.length, `all ${products.length} reachable, got ${reach.size}`);
});

if (process.exitCode === 1) console.error("\nFAIL — format-hard tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} format-hard assertions passed.\n`);
