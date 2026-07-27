/**
 * tests/oracle.partition.test.mjs — STEP 4-a (real repo, red-first). FOUNDATION invariants of the
 * Kernel Authoring Oracle, proven against the REAL kernel primitives (constraintKernel), not a mock.
 * These cover: Partition · state_outcome derivation · COMPROMISE_ONLY has no hard violation · Projection
 * purity · Replay equality · mechanical determinism (input-order shuffle). The remaining 4-a items
 * (opaque pool registry + lineage/MAC, OracleTranscript, Runtime membership differential, monotonicity
 * across transition_kinds, cache, ownership/dependency graph) are the continuing build.
 *
 * OWNERSHIP: the oracle lives under engine/kernel/authoringOracle/ (kernel-owned), NOT authoring/brain2/.
 */
import assert from "node:assert/strict";
import { evaluateState } from "../engine/kernel/authoringOracle/evaluateState.js";
import { projectForAuthoring } from "../engine/kernel/authoringOracle/projections.js";
import { NEVER_RELAX, RELAXABLE } from "../engine/kernel/constraintKernel.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

// A tiny REAL constraint state: a never-relax nominal (type) + a relaxable ordinal (budget tier).
// budget is ORDINAL, so it needs an explicit `order` (the kernel ranks by index; no order ⇒ UNKNOWN).
const constraints = [
  { id: "type", type: "nominal", mode: NEVER_RELAX, priority: 1, requireProof: false },
  { id: "budget", type: "ordinal", mode: RELAXABLE, priority: 2, requireProof: false, order: ["0", "1", "2", "3"] },
];
// units: grounded values per constraint. budget is an ordinal tier (0 cheapest).
const U = (id, type, tier) => ({ id, values: { type: { value: type, grounded: true }, budget: { value: tier, grounded: true } } });
const units = [
  U("p_exact", "oil", 0),      // matches type=oil, within budget tier 0
  U("p_compromise", "oil", 1), // right type, budget over the ceiling by ONE tier (≤ maxBudgetTierDistance=1) → eligible relaxable violation → compromise
  U("p_rejected", "spray", 0), // wrong type (never-relax) → rejected
];
const answers = { type: "oil", budget: 0 }; // want oil, budget tier ≤ 0
const context = { structural_catalog_version: "cat_1", policy_version: "pol_1", kernel_version: "k_1" };

check("PARTITION: exact ∪ compromise ∪ rejected = pool, pairwise disjoint", () => {
  const ev = evaluateState({ units, constraints, answers, context });
  const all = [...ev.exact_ids, ...ev.compromise_ids, ...ev.rejected_ids].sort();
  assert.deepEqual(all, units.map((u) => u.id).sort(), "every candidate lands in exactly one class");
  const sets = [new Set(ev.exact_ids), new Set(ev.compromise_ids), new Set(ev.rejected_ids)];
  for (const u of units) assert.equal(sets.filter((s) => s.has(u.id)).length, 1, `${u.id} in exactly one class`);
});

check("classification is correct against the real kernel (exact / compromise / rejected)", () => {
  const ev = evaluateState({ units, constraints, answers, context });
  assert.ok(ev.exact_ids.includes("p_exact"), "clean match is exact");
  assert.ok(ev.compromise_ids.includes("p_compromise"), "relaxable over-ceiling is compromise");
  assert.ok(ev.rejected_ids.includes("p_rejected"), "never-relax violation is rejected");
});

check("state_outcome is DERIVED inside the oracle (exact>0 ⇒ EXACT_AVAILABLE)", () => {
  assert.equal(evaluateState({ units, constraints, answers, context }).state_outcome, "EXACT_AVAILABLE");
  // remove the exact unit ⇒ COMPROMISE_ONLY
  const noExact = evaluateState({ units: units.filter((u) => u.id !== "p_exact"), constraints, answers, context });
  assert.equal(noExact.state_outcome, "COMPROMISE_ONLY");
  // only the rejected unit ⇒ HONEST_NO_MATCH
  const none = evaluateState({ units: [units[2]], constraints, answers, context });
  assert.equal(none.state_outcome, "HONEST_NO_MATCH");
});

check("COMPROMISE_ONLY / compromise pool admits NO hard (never-relax) violation", () => {
  const ev = evaluateState({ units, constraints, answers, context });
  // p_rejected (never-relax violation) must never be in compromise
  assert.ok(!ev.compromise_ids.includes("p_rejected"), "a never-relax violation can never be a compromise");
});

check("PROJECTION PURITY: the authoring projection carries no ids/violation_vectors/evidence/scores/ranking", () => {
  const ev = evaluateState({ units, constraints, answers, context });
  const proj = projectForAuthoring(ev);
  const keys = JSON.stringify(proj);
  for (const forbidden of ["exact_ids", "compromise_ids", "rejected_ids", "violation_vectors", "evidence_receipts", "scores", "ranking", "pool_digest"]) {
    assert.ok(!keys.includes(forbidden), `authoring projection must not leak ${forbidden}`);
  }
  assert.ok(proj.counts && typeof proj.counts.exact === "number", "brain sees counts");
  assert.ok(proj.state_outcome, "brain sees state_outcome");
  assert.ok(proj.exact_pool_ref && proj.compromise_pool_ref, "brain sees OPAQUE pool refs");
});

check("REPLAY EQUALITY: same legal inputs ⇒ same evaluation_hash (reconstructible, no random ref)", () => {
  const a = evaluateState({ units, constraints, answers, context });
  const b = evaluateState({ units, constraints, answers, context });
  assert.equal(a.evaluation_hash, b.evaluation_hash);
  assert.ok(/^[0-9a-f]{16,}$/.test(a.evaluation_hash), "hash is a stable digest");
});

check("DETERMINISM (mechanical): shuffling input order does NOT change evaluation_hash (no leaked order)", () => {
  const base = evaluateState({ units, constraints, answers, context }).evaluation_hash;
  const shuffled = evaluateState({ units: [units[2], units[0], units[1]], constraints: [constraints[1], constraints[0]], answers, context }).evaluation_hash;
  assert.equal(base, shuffled, "a shuffle-induced hash change would mean input order leaked into the semantics");
});

if (process.exitCode === 1) console.error("\nFAIL — an oracle foundation invariant broke against the real kernel.\n");
else console.log(`\nPASS — all ${passed} oracle-foundation assertions passed (real kernel).\n`);
