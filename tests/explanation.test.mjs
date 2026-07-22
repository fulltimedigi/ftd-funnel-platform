/**
 * tests/explanation.test.mjs — STEP 8 Explanation Layer (language-agnostic).
 *
 * Run: node tests/explanation.test.mjs
 *
 * Asserts the GATING MECHANISM, not specific copy, so the Arabic translation can
 * change freely without breaking logic:
 *   1. HARD RULE §9 — every result renders a non-empty because + nextAction + ≥1 why;
 *      an unresolved token suppresses the whole recommendation.
 *   2. RULE 11 — the rendered why/why-not bullets are EXACTLY the config's bullets
 *      whose `needs` the user's signals satisfy (no more, no less, no fabrication).
 *   3. DUAL-MODE — R1/R2 entry-tier and R6 context switch to the matching variant.
 *   4. CONTEXTUAL — Career-Path surfaces only when goal=from_zero.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { score } from "../engine/scoring.js";
import { resolve } from "../engine/resolver.js";
import { matchRule } from "../engine/decide.js";
import { buildRecommendations, resolveTemplate } from "../engine/recommend.js";

const CFG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../configs/pm-certification-advisor.json", import.meta.url)))
);
const arch = (id) => CFG.archetypes.find((a) => a.id === id);

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}`); console.error("    " + err.message); process.exitCode = 1; }
}

const C = { none: "opt_none", capm: "opt_capm", pmp: "opt_pmp" };
const Q = { dip: "opt_diploma", bach: "opt_bachelor" };
const H = { lt: "opt_lt4500", mid: "opt_4500_7499", hi: "opt_ge7500", unsure: "opt_unsure" };
const E = { priv: "opt_private", gov: "opt_gov", constr: "opt_construction" };
const a = (cr, ql, hr, en, go) => {
  const x = { q_credential: cr };
  if (ql) x.q_qualification = ql; if (hr) x.q_hours = hr;
  if (en) x.q_environment = en; if (go) x.q_goal = go;
  return x;
};
const run = (answers) => {
  const sc = score(CFG, answers);
  return { out: buildRecommendations(resolve(sc, CFG), sc, CFG), signals: sc.signals, result: sc.primary };
};
// the config's OWN bullets that SHOULD render for these signals
const expectClaims = (id, key, signals) =>
  (arch(id).resultExtras[key] || []).filter((b) => matchRule(signals, b.needs || {})).map((b) => b.claim);

/* 1 ─────────────────────────────────────── HARD RULE: every result explains */

console.log("\nHARD RULE §9 — every result renders a complete explanation:");
const REP = {
  R1: a(C.none, Q.bach, H.lt, E.priv),
  R2: a(C.none, Q.dip, H.lt, E.priv),
  R3: a(C.none, Q.bach, H.mid, E.priv),
  R4: a(C.none, Q.bach, H.mid, E.constr),
  R5: a(C.none, Q.bach, H.lt, E.gov),
  R6: a(C.pmp, null, null, E.priv),
  R7: a(C.none, Q.bach, H.unsure, E.priv),
};
for (const [rid, answers] of Object.entries(REP)) {
  check(`${rid} → recommendation + because + nextAction + ≥1 why`, () => {
    const { out, result } = run(answers);
    assert.equal(result, rid);
    assert.ok(out.primary, `${rid} suppressed`);
    assert.ok(out.primary.because && out.primary.because.length > 0);
    assert.ok(out.primary.name);
    assert.ok(out.primary.nextAction);
    assert.ok(out.primary.why.length > 0);
  });
}
check("an unresolved token suppresses the recommendation", () => {
  const bad = { primary: { id: "BAD", recommendations: { primary: { name: "X", becauseTemplate: "needs {missing}" } }, resultExtras: {} } };
  assert.equal(buildRecommendations(bad, { signals: {}, ruleId: null }, CFG).primary, null);
});
check("resolveTemplate: no token → itself; missing → null; present → filled", () => {
  assert.equal(resolveTemplate("نص", {}), "نص");
  assert.equal(resolveTemplate("{x}", {}), null);
  assert.equal(resolveTemplate("{x}!", { x: "ق" }), "ق!");
});

/* 2 ──────────────────── RULE 11: rendered bullets == signal-gated config bullets */

console.log("\nRULE 11 — rendered reasons are EXACTLY the signal-satisfied bullets:");
function gateMatches(id, answers) {
  const { out, signals } = run(answers);
  assert.deepEqual(out.primary.why.map((w) => w.text), expectClaims(id, "why", signals), `${id} why mismatch`);
  assert.deepEqual(out.primary.whyNot.map((w) => w.text), expectClaims(id, "whyNot", signals), `${id} whyNot mismatch`);
}
check("R3 bachelor: only the bachelor-gated bullets render", () => gateMatches("R3", a(C.none, Q.bach, H.mid, E.priv)));
check("R3 diploma(7,500h): only the diploma-gated bullets render", () => gateMatches("R3", a(C.none, Q.dip, H.hi, E.priv)));
check("R1 below(none) vs unsure(entry) render different gated reasons", () => {
  gateMatches("R1", a(C.none, Q.bach, H.lt, E.priv));     // below + none → R1
  gateMatches("R1", a(C.capm, Q.bach, H.unsure, E.priv)); // unsure + entry → R1
});
check("R3 government surfaces one extra why-not (the DS3=government bullet)", () => {
  const gov = run(a(C.none, Q.bach, H.mid, E.gov)).out.primary.whyNot.length;
  const priv = run(a(C.none, Q.bach, H.mid, E.priv)).out.primary.whyNot.length;
  assert.equal(gov, priv + 1);
});

/* 3 ───────────────────────────────────────────── DUAL-MODE (variants) */

console.log("\nDual-mode — recommendation switches to the matching variant:");
check("R1 fresh → base recommendation; holding CAPM → entry variant", () => {
  const fresh = run(a(C.none, Q.bach, H.lt, E.priv)).out.primary;
  const held = run(a(C.capm, Q.bach, H.lt, E.priv)).out.primary;
  assert.equal(fresh.name, arch("R1").recommendations.primary.name);
  assert.equal(held.name, arch("R1").resultExtras.variants[0].name);
  assert.notEqual(fresh.because, held.because);
});
check("R6 switches specialization by environment", () => {
  const variants = arch("R6").resultExtras.variants;
  const constr = run(a(C.pmp, null, null, E.constr)).out.primary;
  const gov = run(a(C.pmp, null, null, E.gov)).out.primary;
  const priv = run(a(C.pmp, null, null, E.priv)).out.primary;
  assert.equal(constr.name, variants.find((v) => v.needs.DS3 === "construction").name);
  assert.equal(gov.name, variants.find((v) => v.needs.DS3 === "government").name);
  assert.equal(priv.name, arch("R6").recommendations.primary.name); // base, no variant
});

/* 4 ───────────────────────────────────────────── CONTEXTUAL offer */

console.log("\nContextual — Career-Path surfaces only when goal=from_zero:");
check("R2 + goal=from_zero adds the contextual bundle", () => {
  const out = run(a(C.none, Q.dip, H.lt, E.priv, "opt_fromzero")).out;
  assert.equal(out.contextual.length, 1);
  assert.equal(out.contextual[0].name, arch("R2").recommendations.contextual[0].name);
});
check("R2 without that goal adds nothing", () => {
  assert.equal(run(a(C.none, Q.dip, H.lt, E.priv, "opt_promotion")).out.contextual.length, 0);
});

/* ================================================================ SUMMARY = */
if (process.exitCode === 1) console.error("\nFAIL — some explanation tests did not pass.\n");
else console.log(`\nPASS — all ${passed} explanation assertions passed.\n`);
