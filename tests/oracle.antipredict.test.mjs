/**
 * tests/oracle.antipredict.test.mjs — STEP 4-a, the two open leaks closed (consultation round-2, #1).
 * ===========================================================================================
 * (1a) NO PRUNING BY PREDICTION. The brain may branch on the kernel's VERDICT; it may never PREDICT the
 *      verdict to drop an option before asking. Mechanically: every option the session was asked to
 *      weigh leaves a MINTED CALL in the record — considered() and transcript() are 1:1, and the ONLY
 *      way to obtain a projection (the thing a branch decision reads) is a minted call. There is no
 *      session method that hides or drops a candidate outside the kernel's `rejected` partition. An
 *      "obviously useless" option removed without a call would show up as a considered/transcript gap.
 * (1b) STATELESS BETWEEN FUNNELS. A session carries no learned patterns from any other funnel; two
 *      sessions share nothing but the pure kernel. No cross-funnel memory is accumulated or applied.
 */
import assert from "node:assert/strict";
import { OracleSession } from "../engine/kernel/authoringOracle/session.js";
import { NEVER_RELAX, RELAXABLE } from "../engine/kernel/constraintKernel.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const constraints = [
  { id: "type", type: "nominal", mode: NEVER_RELAX, priority: 1 },
  { id: "budget", type: "ordinal", mode: RELAXABLE, priority: 2, order: ["0", "1", "2", "3"] },
];
const U = (id, type, tier) => ({ id, values: { type: { value: type, grounded: true }, budget: { value: tier, grounded: true } } });
const units = [U("A", "oil", 0), U("B", "oil", 1), U("C", "spray", 0)];
const ctx = (kv = "k_1") => ({ structural_catalog_version: "cat_1", policy_version: "pol_1", kernel_version: kv });

check("(1a) EVERY considered option leaves a MINTED CALL — considered() and transcript() are 1:1", () => {
  const S = new OracleSession({ constraints, units, context: ctx() });
  const root = S.evaluate({});
  S.refine(root, { type: "oil" });
  S.branch(root, { type: "spray" });
  const considered = S.considered(), transcript = S.transcript();
  assert.equal(considered.length, 3, "three options were weighed");
  assert.equal(considered.length, transcript.length, "no option was weighed without a minted call (no pruning-by-prediction)");
  assert.ok(transcript.every((e) => e.evaluation_hash), "each record is an actual kernel evaluation, not a guess");
});

check("(1a) the ONLY route to a branch-shaping projection is a minted call — there is no hidden-drop API", () => {
  const S = new OracleSession({ constraints, units, context: ctx() });
  // the session exposes evaluate/refine/branch (each mints a call) — and NO method to remove/hide a candidate.
  for (const forbidden of ["prune", "drop", "exclude", "hide", "remove", "guess", "predict"]) {
    assert.equal(typeof S[forbidden], "undefined", `a session must expose no "${forbidden}" — pruning happens ONLY via the kernel's rejected partition`);
  }
  const node = S.evaluate({ type: "oil", budget: 0 });
  assert.ok(node.projection && node.projection.counts, "a projection is only ever the product of a minted evaluation");
});

check("(1b) STATELESS between funnels — a second session shares no memory with the first", () => {
  const S1 = new OracleSession({ constraints, units, context: ctx() });
  S1.evaluate({ type: "oil", budget: 0 });
  S1.evaluate({ type: "oil", budget: 1 });
  const s1Calls = S1.callCount;
  // a DIFFERENT funnel (different catalog) — must not reuse S1's cache, counts, or transcript
  const otherUnits = [U("X", "wood", 0), U("Y", "wood", 2)];
  const S2 = new OracleSession({ constraints, units: otherUnits, context: ctx() });
  const n2 = S2.evaluate({ type: "wood", budget: 0 });
  assert.equal(S1.callCount, s1Calls, "S2 activity does not touch S1's counters (no shared state)");
  assert.equal(S2.transcript().length, 1, "S2's transcript is its own funnel's, from empty");
  assert.equal(S2.cacheHitCount, 0, "S2 did not 'remember' any pattern from S1 (no cross-funnel memoization)");
  assert.ok(n2.projection.counts.exact >= 1, "S2 stands entirely on its own catalog");
});

check("(1b) no cross-funnel memory API — a session cannot import or be seeded with another's learned state", () => {
  const S = new OracleSession({ constraints, units, context: ctx() });
  for (const forbidden of ["seed", "loadMemory", "importPatterns", "priors", "learnFrom", "warmFrom"]) {
    assert.equal(typeof S[forbidden], "undefined", `no "${forbidden}" — a tree is derived from ITS OWN transcript alone`);
  }
});

if (process.exitCode === 1) console.error("\nFAIL — a prediction/memory leak is representable.\n");
else console.log(`\nPASS — all ${passed} anti-prediction / stateless assertions passed.\n`);
