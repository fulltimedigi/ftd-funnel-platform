/**
 * tests/decision.test.mjs — STEP 7 Decision Logic.
 *
 * Run: node tests/decision.test.mjs
 *
 * Proves the decision-table resolver realizes frozen Result Architecture v3:
 *   1. PERSONAS — all 30 v3 adversarial personas, driven as real engine answers
 *      through score()/scoreDecisionTable(), land on their frozen result.
 *   2. TOTALITY — every cell of the derived signal space resolves to exactly one
 *      non-null result (no gap, no ambiguity — the table is a partition).
 *   3. PIPELINE — resolver.resolve() consumes the output unchanged (mode-agnostic).
 *      And the pmp_plus short-circuit (skipped gate questions) still lands on R6.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { score } from "../engine/scoring.js";
import { decide } from "../engine/decide.js";
import { deriveSignals } from "../engine/signals.js";
import { resolve } from "../engine/resolver.js";

const CFG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../configs/pm-certification-advisor.json", import.meta.url)))
);

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error("    " + err.message);
    process.exitCode = 1;
  }
}

/* answer-id shorthands */
const C = { none: "opt_none", capm: "opt_capm", prince2f: "opt_prince2f", pmp: "opt_pmp" };
const Q = { dip: "opt_diploma", bach: "opt_bachelor" };
const H = { lt: "opt_lt4500", mid: "opt_4500_7499", hi: "opt_ge7500", unsure: "opt_unsure" };
const E = { priv: "opt_private", gov: "opt_gov", constr: "opt_construction", notyet: "opt_notyet" };

const a = (credential, qualification, hours, environment, goal) => {
  const ans = { q_credential: credential };
  if (qualification) ans.q_qualification = qualification;
  if (hours) ans.q_hours = hours;
  if (environment) ans.q_environment = environment;
  if (goal) ans.q_goal = goal;
  return ans;
};

/* The 30 frozen v3 personas (final adversarial set).
   Note: 14/15 use hi+notyet to exercise the clamp; 26–29 use the pmp short-circuit. */
const PERSONAS = [
  [1,  a(C.none, Q.bach, H.mid, E.priv, "opt_promotion"),  "R3"],
  [2,  a(C.none, Q.bach, H.mid, E.priv, "opt_mobility"),   "R3"],
  [3,  a(C.none, Q.dip,  H.hi,  E.priv, "opt_corporate"),  "R3"],
  [4,  a(C.none, Q.bach, H.lt,  E.priv, "opt_promotion"),  "R1"],
  [5,  a(C.none, Q.dip,  H.lt,  E.priv, "opt_fromzero"),   "R2"],
  [6,  a(C.none, Q.bach, H.unsure, E.priv),                "R7"],
  [7,  a(C.none, Q.bach, H.mid, E.constr, "opt_promotion"),"R4"],
  [8,  a(C.none, Q.bach, H.mid, E.gov, "opt_promotion"),   "R3"],
  [9,  a(C.none, Q.bach, H.mid, E.gov, "opt_mobility"),    "R3"],
  [10, a(C.none, Q.bach, H.mid, E.gov, "opt_corporate"),   "R3"],
  [11, a(C.none, Q.bach, H.lt,  E.gov, "opt_promotion"),   "R5"],
  [12, a(C.none, Q.dip,  H.lt,  E.gov, "opt_corporate"),   "R5"],
  [13, a(C.none, Q.bach, H.unsure, E.gov),                 "R5"],
  [14, a(C.none, Q.bach, H.hi,  E.notyet, "opt_mobility"), "R1"], // clamp meets→below
  [15, a(C.none, Q.dip,  H.hi,  E.notyet, "opt_fromzero"), "R2"], // clamp meets→below
  [16, a(C.none, Q.bach, H.lt,  E.notyet, "opt_fromzero"), "R1"],
  [17, a(C.capm, Q.bach, H.lt,  E.priv, "opt_promotion"),  "R1"], // entry, no re-sell
  [18, a(C.capm, Q.dip,  H.lt,  E.priv, "opt_promotion"),  "R2"],
  [19, a(C.capm, Q.bach, H.unsure, E.priv),                "R1"], // entry+unsure → R1 not R7
  [20, a(C.prince2f, Q.bach, H.lt, E.gov, "opt_promotion"),"R1"], // entry, not re-sold PRINCE2
  [21, a(C.capm, Q.bach, H.lt,  E.gov, "opt_promotion"),   "R1"],
  [22, a(C.capm, Q.bach, H.mid, E.priv, "opt_promotion"),  "R3"], // advances to PMP
  [23, a(C.capm, Q.bach, H.mid, E.gov, "opt_mobility"),    "R3"],
  [24, a(C.capm, Q.bach, H.mid, E.constr, "opt_promotion"),"R4"],
  [25, a(C.none, Q.bach, H.lt,  E.priv, "opt_fromzero"),   "R1"], // ITIL holder picks "none"
  [26, a(C.pmp,  null,   null,  E.priv, "opt_promotion"),  "R6"], // short-circuit
  [27, a(C.pmp,  null,   null,  E.gov,  "opt_promotion"),  "R6"],
  [28, a(C.pmp,  null,   null,  E.constr, "opt_mobility"), "R6"],
  [29, a(C.pmp,  null,   null,  E.priv, "opt_promotion"),  "R6"], // "below" is moot
  [30, a(C.none, Q.dip,  H.hi,  E.gov, "opt_mobility"),    "R3"], // dip 7,500h reaches PMP in gov
];

console.log("\n30 frozen v3 personas → engine result:");
for (const [n, answers, expected] of PERSONAS) {
  check(`persona ${n} → ${expected}`, () => {
    const r = score(CFG, answers);
    assert.equal(r.primary, expected, `got ${r.primary} (rule ${r.ruleId})`);
  });
}

/* 2 ─────────────────────────────────────────────── TOTALITY (partition) */

console.log("\nTotality — the table is a complete partition (no gap, no ambiguity):");
check("every derived signal cell resolves to exactly one non-null result", () => {
  const DS1 = ["diploma", "bachelor_plus"];
  const DS2 = ["meets", "below", "unsure"];
  const DS3 = ["private", "government", "construction", "not_yet_working"];
  const DS5 = ["none", "entry_level", "pmp_plus"];
  let cells = 0;
  const hits = new Set();
  for (const d1 of DS1) for (const d2 of DS2) for (const d3 of DS3) for (const d5 of DS5) {
    cells++;
    const { result } = decide({ DS1: d1, DS2: d2, DS3: d3, DS5: d5 }, CFG.decisionTable);
    assert.ok(result, `no result for ${d1}/${d2}/${d3}/${d5}`);
    hits.add(result);
  }
  assert.equal(cells, 2 * 3 * 4 * 3); // 72 cells
  // all seven archetypes are reachable somewhere in the space
  assert.deepEqual([...hits].sort(), ["R1", "R2", "R3", "R4", "R5", "R6", "R7"]);
});
check("the safety default never fires for well-formed signals", () => {
  // walk the same space; r12 should never be the matching rule
  const DS2 = ["meets", "below", "unsure"], DS3 = ["private", "government", "construction", "not_yet_working"];
  for (const d1 of ["diploma", "bachelor_plus"]) for (const d2 of DS2) for (const d3 of DS3) for (const d5 of ["none", "entry_level", "pmp_plus"]) {
    const { ruleId } = decide({ DS1: d1, DS2: d2, DS3: d3, DS5: d5 }, CFG.decisionTable);
    assert.notEqual(ruleId, "r12_safety_default");
  }
});
check("malformed/empty signals fall to the safety default (R7), never crash", () => {
  const { result, ruleId } = decide({}, CFG.decisionTable);
  assert.equal(result, "R7");
  assert.equal(ruleId, "r12_safety_default");
});

/* 3 ─────────────────────────────────────────────── PIPELINE integration */

console.log("\nPipeline — existing resolver consumes decision-table output:");
check("resolver.resolve maps the result id to its archetype object", () => {
  const stub = { ...CFG, archetypes: [{ id: "R3", name: "PMP" }, { id: "R1", name: "CAPM" }] };
  const scoring = score(stub, a(C.none, Q.bach, H.mid, E.priv));
  const resolved = resolve(scoring, stub);
  assert.equal(resolved.primary.id, "R3");
  assert.equal(resolved.primary.name, "PMP");
  assert.equal(resolved.proportion.primaryPct, 100);
});
check("derived signals are carried on the scoring output for because-templates", () => {
  const scoring = score(CFG, a(C.none, Q.bach, H.hi, E.notyet));
  assert.equal(scoring.signals.DS2, "below");        // clamp applied
  assert.equal(scoring.signals.meta.clamped, true);
  assert.equal(scoring.ruleId, "r9_none_below_bach");
});

/* ================================================================ SUMMARY = */
if (process.exitCode === 1) {
  console.error("\nFAIL — some decision-logic tests did not pass.\n");
} else {
  console.log(`\nPASS — all ${passed} decision-logic assertions passed.\n`);
}
