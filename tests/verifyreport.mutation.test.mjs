/**
 * tests/verifyreport.mutation.test.mjs — STEP 1 (ADR-0043): prove the empty-truth death.
 * The publish-gate verifier used to return a bare boolean, so an ABSENT/EMPTY decision table "passed"
 * vacuously (checked=0 → findings=[] → ok=true) and recordFrom served it READY. These MUTATION tests
 * kill that: each mutation (empty table, zeroed checked, broken expected, success-on-empty, deleted
 * proof) MUST make the derived `ok` false. If any stays green, the empty-set lie is back.
 */
import assert from "node:assert/strict";
import { deriveOk, makeReport } from "../engine/kernel/verificationReport.js";
import { verifyFunnel } from "../engine/kernel/verifyFunnel.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

/* ── deriveOk unit mutations — the independent library fails closed ── */
const good = { expected_count: 3, observed_count: 3, checked_count: 3, passed_count: 3, failed_count: 0, skipped_count: 0, missing_ids: [] };
check("deriveOk: a fully-covered report is ok", () => assert.equal(deriveOk(good), true));
check("MUTANT empty: expected_count=0 → NOT ok (the vacuous-truth death)", () => assert.equal(deriveOk({ ...good, expected_count: 0, observed_count: 0, checked_count: 0, passed_count: 0 }), false));
check("MUTANT zeroed checked: checked_count=0 → NOT ok", () => assert.equal(deriveOk({ ...good, checked_count: 0, passed_count: 0 }), false));
check("MUTANT broken expected: observed≠expected → NOT ok", () => assert.equal(deriveOk({ ...good, observed_count: 2 }), false));
check("MUTANT skipped: skipped_count>0 → NOT ok", () => assert.equal(deriveOk({ ...good, checked_count: 2, passed_count: 2, skipped_count: 1 }), false));
check("MUTANT failure: failed_count>0 → NOT ok", () => assert.equal(deriveOk({ ...good, failed_count: 1, passed_count: 2 }), false));
check("MUTANT success-on-empty via makeReport({}) → NOT ok", () => assert.equal(makeReport({}).ok, false));

/* ── verifyFunnel integration mutations — the real publish-gate verifier ── */
const V = { catalog_version: "c1", policy_version: "p1", answer_contract_version: "a1", config_hash: "h1", locale_bundle_version: "l1" };
const PROVEN = "https://shop.example/products/x";
const goodConfig = () => ({
  id: "t", scoring: { mode: "decision-table" }, resultLayout: "commerce", ...V,
  constraintPolicy: [], archetypes: [{ id: "R1", recommendations: { primary: { url: PROVEN, name: "X" } } }],
  decisionTable: [
    { id: "r_0", kind: "COMMERCE", when: { D_x: "a" }, result: "R1", proof: { product_id: PROVEN, match_state: "EXACT", conflicts: [], unknowns: [] } },
    { id: "r_default", kind: "TERMINAL", when: {}, terminal_state: "RESTART_REQUIRED" },
  ],
});
const catalog = { products: [{ url: PROVEN }] };

check("verifyFunnel: a well-formed funnel passes (expected>0, checked=expected, failed=0)", () => {
  const r = verifyFunnel(goodConfig(), catalog);
  assert.equal(r.ok, true);
  assert.ok(r.report && r.report.expected_count >= 1, "report carries a non-zero expected_count");
});
check("MUTANT empty decisionTable → verifyFunnel NOT ok (was the vacuous pass that served ruins)", () => {
  const c = goodConfig(); c.decisionTable = [];
  const r = verifyFunnel(c, catalog);
  assert.equal(r.ok, false, "an empty decision table must FAIL the publish gate, not pass vacuously");
  assert.equal(r.report.expected_count, 0);
});
check("MUTANT no decisionTable key at all → NOT ok", () => {
  const c = goodConfig(); delete c.decisionTable;
  assert.equal(verifyFunnel(c, catalog).ok, false);
});
check("MUTANT deleted proof on a COMMERCE rule → NOT ok (failed_count>0)", () => {
  const c = goodConfig(); delete c.decisionTable[0].proof;
  const r = verifyFunnel(c, catalog);
  assert.equal(r.ok, false);
  assert.ok(r.report.failed_count > 0);
});

if (process.exitCode === 1) console.error("\nFAIL — a mutation slipped past the derived ok (empty-truth lie is back).\n");
else console.log(`\nPASS — all ${passed} verification-report mutation assertions passed.\n`);
