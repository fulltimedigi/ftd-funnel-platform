/**
 * tests/kernel.ceiling.test.mjs — the budget_ceiling AXIS ROLE (ق13) + branch-exclusion (delivery step 3, root).
 * ===========================================================================================================
 * The root cause of brain2 under-serving the gold (ADR-0067): budget was matched band-EXACT (equality) and
 * BRANCHED like a partition axis. ق13 says budget_ceiling is "≤ ceiling", and — because a ceiling does NOT
 * partition (a family qualifies for every band ≤ its cheapest) — it is a LEAF-LEVEL filter, never an info-gain
 * branch (brain + certifier ADR-0063 both do variant-level budget at the leaf). This proves BOTH capabilities in
 * isolation (no shared fixture touched): they are the foundation the tree completion (ADR-0068) activates.
 */
import assert from "node:assert/strict";
import { status, EXACT } from "../engine/kernel/constraintKernel.js";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const order = ["low", "mid", "high"];
const ceilAxis = { id: "budget", type: "ordinal", mode: "RELAXABLE", order, role: "budget_ceiling" };
const plainAxis = { id: "tier", type: "ordinal", mode: "RELAXABLE", order };

check("budget_ceiling: a unit AT/BELOW the answered band SATISFIES (≤ ceiling), OVER-ceiling overshoots", () => {
  // answer = "mid" ceiling.
  assert.deepEqual(status(ceilAxis, "mid", { value: "low", grounded: true }), { state: "SAT", magnitude: 0 }, "low ≤ mid ⇒ SAT (cheaper is fine)");
  assert.deepEqual(status(ceilAxis, "mid", { value: "mid", grounded: true }), { state: "SAT", magnitude: 0 }, "mid ≤ mid ⇒ SAT");
  const over = status(ceilAxis, "mid", { value: "high", grounded: true });
  assert.equal(over.state, "VIOLATED", "high > mid ⇒ VIOLATED (over the ceiling)");
  assert.equal(over.magnitude, 1, "overshoot magnitude = 1 band");
});

check("PLAIN ordinal is UNCHANGED — still symmetric equality (the ceiling is role-gated, not a global change)", () => {
  assert.equal(status(plainAxis, "mid", { value: "low", grounded: true }).state, "VIOLATED", "plain ordinal: low ≠ mid ⇒ VIOLATED (symmetric)");
  assert.equal(status(plainAxis, "mid", { value: "mid", grounded: true }).state, "SAT", "plain ordinal: mid == mid ⇒ SAT");
});

check("branch-exclusion: an oracle EXCLUDES a budget_ceiling axis from branchable axes (it is a LEAF filter)", () => {
  const units = [
    { id: "a", values: { type: { value: "oil", grounded: true }, budget: { value: "low", grounded: true } } },
    { id: "b", values: { type: { value: "perfume", grounded: true }, budget: { value: "high", grounded: true } } },
  ];
  const contracts = [
    { axis_id: "type", type: "nominal", mode: "NEVER_RELAX", priority: 1 },
    { axis_id: "budget", type: "ordinal", mode: "RELAXABLE", priority: 2, order, role: "budget_ceiling" },
  ];
  const o = new AuthoringOracle({ units, resolvedContracts: contracts, context: { kernel_version: "k_test" } });
  assert.deepEqual(o.ceilingAxisIds(), ["budget"], "budget is a ceiling axis");
  assert.deepEqual(o.branchableAxisIds(), ["type"], "budget is NOT branchable (a leaf filter); only type branches");
  assert.deepEqual(o.axisIds().sort(), ["budget", "type"], "both axes still exist for matching (leaf-time ceiling)");
});

if (process.exitCode === 1) console.error("\nFAIL — the budget_ceiling role or branch-exclusion is not sound.\n");
else console.log(`\nPASS — all ${passed} ceiling checks. budget_ceiling matches ≤ ceiling (role-gated; plain ordinal unchanged); a ceiling axis is excluded from branching (leaf filter). Foundation for brain2 tree completion (ADR-0068).\n`);
