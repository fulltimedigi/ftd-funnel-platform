/**
 * tests/trust.test.mjs — STEP 9 Trust Validation.
 *
 * Run: node tests/trust.test.mjs
 *
 * Two halves:
 *   A. THE GATE — the assembled PM Certification Advisor passes with zero blockers.
 *   B. THE TEETH — a validator that passes everything is worthless, so each
 *      violation class is injected into a clone and must be caught. (If the gate
 *      can't fail, it isn't a gate.)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { trustValidate } from "../engine/trustValidate.js";

const CFG = JSON.parse(
  readFileSync(fileURLToPath(new URL("../configs/pm-certification-advisor.json", import.meta.url)))
);
const clone = () => JSON.parse(JSON.stringify(CFG));

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}`); console.error("    " + err.message); process.exitCode = 1; }
}
const codes = (r) => r.findings.filter((f) => f.severity === "blocker").map((f) => f.code);

/* A ───────────────────────────────────────────────────────── THE GATE */

console.log("\nThe gate — assembled funnel passes Trust Validation:");
check("PM Certification Advisor: ok=true, zero blockers", () => {
  const r = trustValidate(CFG);
  if (!r.ok) console.error("    blockers: " + JSON.stringify(r.findings.filter(f => f.severity === "blocker"), null, 2));
  assert.equal(r.ok, true);
  assert.equal(r.findings.filter((f) => f.severity === "blocker").length, 0);
});
check("no warnings either (all 7 results reachable & described)", () => {
  const r = trustValidate(CFG);
  assert.equal(r.findings.length, 0, JSON.stringify(r.findings));
});

/* B ───────────────────────────────────────────────────────── THE TEETH */

console.log("\nThe teeth — every violation class is caught:");

check("TV1: a rule pointing at a non-existent archetype is caught", () => {
  const c = clone();
  c.decisionTable[0].result = "R99";
  assert.ok(codes(trustValidate(c)).includes("TV1_RESULT_MISSING"));
});
check("TV1: an archetype missing its recommendation is caught", () => {
  const c = clone();
  delete c.archetypes.find((a) => a.id === "R3").recommendations.primary.becauseTemplate;
  assert.ok(codes(trustValidate(c)).includes("TV1_NO_RECOMMENDATION"));
});
check("TV2: a question that feeds no signal (theater) is caught", () => {
  const c = clone();
  c.questions.push({ id: "q_theater", label: "x", text: "decorative", options: [{ id: "o", label: "o" }] });
  assert.ok(codes(trustValidate(c)).includes("TV2_QUESTION_NO_SIGNAL"));
});
check("TV2: an unmapped option is caught", () => {
  const c = clone();
  c.questions.find((q) => q.id === "q_environment").options.push({ id: "opt_orphan", label: "?" });
  assert.ok(codes(trustValidate(c)).includes("TV2_OPTION_UNMAPPED"));
});
check("TV2: an orphan decision signal (unused by the table) is caught", () => {
  const c = clone();
  // strip every mention of DS1 from the table → it now collects nothing
  for (const r of c.decisionTable) delete r.when.DS1;
  assert.ok(codes(trustValidate(c)).includes("TV2_ORPHAN_SIGNAL"));
});
check("TV3: a bullet gated on an undefined signal is caught (GAP-A class)", () => {
  const c = clone();
  c.archetypes.find((a) => a.id === "R3").resultExtras.why.push({ needs: { DS9: "x" }, claim: "fabricated" });
  assert.ok(codes(trustValidate(c)).includes("TV3_NEEDS_UNDEFINED_SIGNAL"));
});
check("TV3: a needs value outside its signal domain is caught", () => {
  const c = clone();
  c.archetypes.find((a) => a.id === "R3").resultExtras.why.push({ needs: { DS2: "totally_meets" }, claim: "x" });
  assert.ok(codes(trustValidate(c)).includes("TV3_NEEDS_BAD_VALUE"));
});
check("TV3: a result that can render no because is caught by the sweep", () => {
  const c = clone();
  // break R7's only because → some unsure cells now suppress
  c.archetypes.find((a) => a.id === "R7").recommendations.primary.becauseTemplate = "needs {missing}";
  assert.ok(codes(trustValidate(c)).includes("TV3_NO_BECAUSE"));
});
check("TV3: a result with zero defensible why-bullets is caught", () => {
  const c = clone();
  c.archetypes.find((a) => a.id === "R3").resultExtras.why = [];
  assert.ok(codes(trustValidate(c)).includes("TV3_NO_WHY"));
});
check("TV1: contextual misplaced under resultExtras is caught", () => {
  const c = clone();
  const r3 = c.archetypes.find((a) => a.id === "R3");
  r3.resultExtras.contextual = [{ name: "X", url: "u", becauseTemplate: "b" }];
  assert.ok(codes(trustValidate(c)).includes("TV1_CONTEXTUAL_MISPLACED"));
});
check("TV5: fake-intelligence vocabulary (Rule 8) is caught", () => {
  const c = clone();
  c.archetypes.find((a) => a.id === "R1").description = "We analyzed your leadership style and personality.";
  assert.ok(codes(trustValidate(c)).includes("TV5_FAKE_INTELLIGENCE"));
});

/* ================================================================ SUMMARY = */
if (process.exitCode === 1) console.error("\nFAIL — some trust-validation tests did not pass.\n");
else console.log(`\nPASS — all ${passed} trust-validation assertions passed.\n`);
