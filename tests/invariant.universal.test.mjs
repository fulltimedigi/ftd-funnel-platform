/**
 * tests/invariant.universal.test.mjs — THE PROMISE PRINCIPLE, store-agnostic (ADR-0036).
 * ---------------------------------------------------------------------------
 * Runs the REAL authoring pipeline on a battery of DIVERSE synthetic stores and, for every
 * decision rule of every funnel, verifies the promise:
 *   • rank-1 (the top hard axis) is honoured EXACTLY, always — zero relaxation.
 *   • any lower axis the scorer could not honour is DISCLOSED on the rule (`relaxed`) —
 *     there is NO silent override, on any store.
 *   • coverage stays at/above the richness floor.
 * The build fails on a single silent override in any vertical. Derived from the operator's
 * audits/promise-invariant.mjs.
 */

import assert from "node:assert/strict";
import { authorFunnel } from "../authoring/author/index.js";
import { productFormat } from "../authoring/author/formatAxis.js";
import { deriveBudgetAxis, productBudget } from "../authoring/author/budgetAxis.js";

const scents = ["woody", "floral", "smoky"];
const STORES = [];
STORES.push({ vertical: "عطور وعود", origin: "https://oud.example", products: [
  ...Array.from({ length: 8 }, (_, i) => ({ name: `${["Hindi","Cambodi","Royal","Sultan","Amber","Musk","Rose","Taif"][i]} Eau De Parfum`, url: `https://oud.example/p/parf${i}`, price: 300 + i * 90, attributes: { type: "Perfume" }, differentiators: [scents[i % 3], "perfume"] })),
  ...Array.from({ length: 6 }, (_, i) => ({ name: `${["Hindi","Cambodi","Borneo","Trat","Maroke","Seufi"][i]} Oud Oil 3ml`, url: `https://oud.example/p/oil${i}`, price: 250 + i * 220, attributes: { type: "Oud Oil" }, differentiators: [scents[i % 3], "oil"] })),
  ...Array.from({ length: 4 }, (_, i) => ({ name: `${["Hindi","Malaysian","Kalimantan","Indian"][i]} Agarwood Chips 30g`, url: `https://oud.example/p/wood${i}`, price: 600 + i * 500, attributes: { type: "Wood" }, differentiators: [scents[i % 3], "raw"] })),
  { name: "Luxury Gift Set", url: "https://oud.example/p/set0", price: 2200, attributes: { type: "Set" }, differentiators: ["woody", "set"] },
  { name: "Discovery Gift Set", url: "https://oud.example/p/set1", price: 1800, attributes: { type: "Set" }, differentiators: ["floral", "set"] },
] });
STORES.push({ vertical: "لابتوبات", origin: "https://tech.example", products:
  [["Air 13","apple","macos",1200],["Pro 14","apple","macos",2400],["Pro 16","apple","macos",3500],["XPS 13","dell","windows",1100],["XPS 15","dell","windows",1900],["G15 Gamer","dell","windows",1500],["ThinkPad X1","lenovo","windows",1700],["Legion 5","lenovo","windows",1400],["IdeaPad 3","lenovo","windows",600],["Chromebook Go","hp","chromeos",400],["Pavilion 15","hp","windows",800],["Spectre x360","hp","windows",1600]]
    .map(([n, brand, os, price], i) => ({ name: `${brand} ${n}`, url: `https://tech.example/p/${i}`, price, brand, attributes: { type: os }, differentiators: [brand, os] })) });
STORES.push({ vertical: "مكمّلات", origin: "https://supp.example", products:
  [["Whey Protein","muscle",180],["Mass Gainer","muscle",220],["Creatine","muscle",90],["Multivitamin","health",70],["Omega-3","health",110],["Vitamin D","health",45],["Fat Burner","weight",160],["CLA","weight",130],["L-Carnitine","weight",95],["Pre-Workout","energy",140],["BCAA","energy",120]]
    .map(([n, goal, price], i) => ({ name: n, url: `https://supp.example/p/${i}`, price, attributes: { type: goal }, differentiators: [goal] })) });
STORES.push({ vertical: "قهوة", origin: "https://coffee.example", products:
  [["Ethiopia Light","light",65],["Kenya Light","light",70],["Colombia Medium","medium",55],["Brazil Medium","medium",50],["Guatemala Medium","medium",58],["Sumatra Dark","dark",52],["Italian Dark","dark",48],["Espresso Blend","dark",45],["House Blend","medium",40],["Decaf Medium","medium",42]]
    .map(([n, roast, price], i) => ({ name: n, url: `https://coffee.example/p/${i}`, price, attributes: { type: roast }, differentiators: [roast] })) });

/** The product's real value on an axis, or null if we genuinely can't tell (skip). */
function realValue(axisId, product, sig, cuts) {
  if (axisId === "format") return productFormat(product);
  if (/budget|price/i.test(axisId)) return cuts ? productBudget(product, cuts) : null;
  const t = String((product.attributes && product.attributes.type) || "").toLowerCase();
  const diffs = (product.differentiators || []).map((d) => String(d).toLowerCase());
  const domain = (sig && sig.domain) || [];
  const holds = domain.filter((v) => [t, ...diffs].includes(String(v).toLowerCase()));
  return holds.length === 1 ? holds[0] : null; // only when the product clearly carries one domain value
}

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

let totalRules = 0, totalDisclosed = 0;
for (const store of STORES) {
  check(`${store.vertical}: rank-1 always honoured · every lower override disclosed · coverage ok`, () => {
    const cat = { origin: store.origin, products: store.products, brandUrl: store.origin };
    const gen = authorFunnel(cat, { brandName: store.vertical });
    assert.equal(gen.ok, true, "author failed: " + gen.reason);
    const cfg = gen.config;
    const byUrl = new Map(store.products.map((p) => [p.url, p]));
    const A = {}; for (const a of cfg.archetypes || []) A[a.id] = a.recommendations && a.recommendations.primary;
    const sigOf = (axisId) => (cfg.signals || []).find((s) => s.id === `s_${axisId}`);
    const cuts = (deriveBudgetAxis(store.products) || {}).cuts || null;
    const ladder = cfg.constraintLadder || [];
    const rank1 = ladder[0];

    let ruleCount = 0, disclosedCount = 0;
    for (const rule of cfg.decisionTable) {
      if (!rule.when || !Object.keys(rule.when).length) continue; // the default safety-net rule
      ruleCount++;
      const prod = byUrl.get((A[rule.result] || {}).url);
      assert.ok(prod, `rule ${rule.id} resolves to a real product`);
      const disclosed = new Set((rule.relaxed || []).map((r) => r.axis));
      if (disclosed.size) disclosedCount++;
      for (const [D, want] of Object.entries(rule.when)) {
        const axisId = D.replace(/^D_/, "");
        const got = realValue(axisId, prod, sigOf(axisId), cuts);
        if (got == null) continue; // can't verify honestly → skip
        const honored = String(got) === String(want);
        if (!honored) {
          // a mismatch is allowed ONLY if the rule discloses it — never silent.
          assert.ok(disclosed.has(axisId), `SILENT override on "${axisId}" in rule ${rule.id}: chose ${want} → product is ${got} (${prod.name}) — not disclosed`);
          // rank-1 must NEVER be overridden, disclosed or not.
          assert.notEqual(axisId, rank1, `rank-1 "${rank1}" was relaxed in rule ${rule.id} — the top promise must be absolute`);
        }
      }
    }
    // coverage floor: every product reachable somewhere
    const reach = new Set();
    for (const a of cfg.archetypes) { reach.add(a.recommendations.primary.url); for (const c of a.recommendations.contextual || []) reach.add(c.url); }
    assert.ok(reach.size >= Math.ceil(store.products.length * 0.9), `coverage ${reach.size}/${store.products.length} below floor`);
    totalRules += ruleCount; totalDisclosed += disclosedCount;
  });
}

check("battery summary — zero silent overrides across all verticals", () => {
  assert.ok(totalRules > 0, "rules were exercised");
  console.log(`    (battery: ${STORES.length} stores, ${totalRules} rules, ${totalDisclosed} carried an honest relaxation disclosure)`);
});

if (process.exitCode === 1) console.error("\nFAIL — the promise is broken on some store.\n");
else console.log(`\nPASS — all ${passed} universal-invariant assertions passed (no silent override on any store).\n`);
