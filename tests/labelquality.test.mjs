/**
 * tests/labelquality.test.mjs — the P0 label-quality guard (FUNNEL-QUALITY-FIX-PLAN).
 * Junk mined tokens (based/de/packages/units) must never survive as shopper-facing options;
 * real attributes (origin/concentration/format words, Arabic labels) must pass. Also proves a
 * taste axis collapses to <2 options → dropped, and budget cutpoints round to human steps.
 */

import assert from "node:assert/strict";
import { isJunkLabel, meaningfulOptions } from "../engine/kernel/labelQuality.js";
import { niceRound, priceCutpoints } from "../authoring/author/budgetAxis.js";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

console.log("\nlabel-quality — junk rejection:");
check("the real oudfactory junk is rejected", () => {
  assert.equal(isJunkLabel("based"), true);
  assert.equal(isJunkLabel("de"), true);
  assert.equal(isJunkLabel("De"), true);
  assert.equal(isJunkLabel("packages"), true);
});
check("fragments, function words, bare numbers/units are rejected", () => {
  assert.equal(isJunkLabel("a"), true);
  assert.equal(isJunkLabel("of"), true);
  assert.equal(isJunkLabel("eau"), true);
  assert.equal(isJunkLabel("box"), true);
  assert.equal(isJunkLabel("50"), true);
  assert.equal(isJunkLabel("100 ml"), true);
  assert.equal(isJunkLabel(""), true);
  assert.equal(isJunkLabel(null), true);
});
check("real attributes pass (English proper nouns + Arabic)", () => {
  assert.equal(isJunkLabel("Indian"), false);
  assert.equal(isJunkLabel("Cambodi"), false);
  assert.equal(isJunkLabel("Malaysian"), false);
  assert.equal(isJunkLabel("Parfum"), false);
  assert.equal(isJunkLabel("عطر بخّاخ"), false);
  assert.equal(isJunkLabel("هندي"), false);
  assert.equal(isJunkLabel("اقتصادي"), false);
});

console.log("\nlabel-quality — axis collapse:");
check("meaningfulOptions drops junk; a junk-only axis collapses below 2", () => {
  const junky = meaningfulOptions([{ value: "based", label: "based" }, { value: "de", label: "de" }, { value: "packages", label: "packages" }]);
  assert.equal(junky.length, 0); // → author drops the whole axis
  const mixed = meaningfulOptions([{ value: "indian", label: "Indian" }, { value: "de", label: "de" }]);
  assert.equal(mixed.length, 1); // 1 real + 1 junk → still < 2 → dropped
  const good = meaningfulOptions([{ value: "indian", label: "Indian" }, { value: "cambodi", label: "Cambodi" }]);
  assert.equal(good.length, 2); // kept
});

console.log("\nbudget — human rounding:");
check("niceRound snaps to human steps", () => {
  assert.equal(niceRound(459), 450);
  assert.equal(niceRound(945), 950);
  assert.equal(niceRound(47), 47);   // below 100 → kept exact (a unit or two matters)
  assert.equal(niceRound(1234), 1200);
});
check("priceCutpoints returns rounded, still strictly increasing", () => {
  const prices = [120, 200, 300, 459, 600, 780, 945, 1100, 1500];
  const cuts = priceCutpoints(prices.map((price) => ({ price })));
  assert.ok(Array.isArray(cuts) && cuts.length >= 1);
  for (let i = 1; i < cuts.length; i++) assert.ok(cuts[i] > cuts[i - 1]);
  cuts.forEach((c) => assert.equal(c % 10, 0)); // human step
});

console.log(`\nlabelquality — ${passed} checks passed.\n`);
