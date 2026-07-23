/**
 * tests/richness.test.mjs — the "too thin" gate (ADR-0028, Track A).
 * Teeth: thin-on-rich MUST fail, rich MUST pass, thin-on-small MUST pass.
 */

import assert from "node:assert/strict";
import { richnessCheck } from "../authoring/quality/richnessCheck.js";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

const catalogOf = (n) => ({ products: Array.from({ length: n }, (_, i) => ({ name: "P" + i, url: "https://s/p/" + i })) });
// build a config with q questions and archetypes reaching the given product urls
function cfg(q, urls) {
  return {
    questions: Array.from({ length: q }, (_, i) => ({ id: "q" + i })),
    archetypes: urls.map((u, i) => ({ id: "R" + i, recommendations: { primary: { name: "P", url: u } } })),
  };
}
const urls = (n, offset = 0) => Array.from({ length: n }, (_, i) => "https://s/p/" + (i + offset));

console.log("\nrichness gate:");

check("THIN on a RICH catalog is REJECTED (2 Q, 12% coverage, 51 products)", () => {
  const r = richnessCheck(cfg(2, urls(6)), catalogOf(51));
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === "RICHNESS_THIN_QUESTIONS"));
  assert.ok(r.findings.some((f) => f.code === "RICHNESS_LOW_COVERAGE"));
});

check("RICH funnel PASSES (6 Q, near-full coverage on a big catalog)", () => {
  // The covering assignment (ADR-0031) makes near-full coverage the bar: a genuinely
  // rich funnel now reaches ~all of the catalog, not a fraction of it.
  const r = richnessCheck(cfg(6, urls(48)), catalogOf(51));
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.ok(r.metrics.coverage >= 0.9, `coverage ${r.metrics.coverage}`);
});

check("a MID-coverage funnel that used to pass (59%) is now REJECTED (raised gate)", () => {
  const r = richnessCheck(cfg(6, urls(30)), catalogOf(51)); // 30/51 = 59%
  assert.equal(r.ok, false, "59% coverage must fail the near-full gate");
  assert.ok(r.findings.some((f) => f.code === "RICHNESS_LOW_COVERAGE"));
});

check("THIN on a SMALL catalog PASSES (honest floor — never pad questions)", () => {
  const r = richnessCheck(cfg(2, urls(4)), catalogOf(6));
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.equal(r.metrics.catalogJustifiesDepth, false);
});

check("enough questions but LOW coverage on a rich catalog is REJECTED", () => {
  const r = richnessCheck(cfg(5, urls(4)), catalogOf(40));
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === "RICHNESS_LOW_COVERAGE"));
  assert.ok(!r.findings.some((f) => f.code === "RICHNESS_THIN_QUESTIONS"));
});

check("coverage counts contextual recommendations too, de-duplicated", () => {
  const config = {
    questions: [1, 2, 3, 4].map((i) => ({ id: "q" + i })),
    archetypes: [
      { recommendations: { primary: { url: "u1" }, contextual: [{ url: "u2" }, { url: "u3" }] } },
      { recommendations: { primary: { url: "u1" }, contextual: [{ url: "u4" }] } }, // u1 dup
    ],
  };
  const r = richnessCheck(config, catalogOf(12));
  assert.equal(r.metrics.reachable, 4); // u1,u2,u3,u4
});

if (process.exitCode === 1) console.error("\nFAIL — richness tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} richness assertions passed.\n`);
