/**
 * tests/safety.test.mjs — fail-closed safety guard (ADR-0037 closing, item 3).
 * A safety/allergen/compatibility/legal claim is grounded ONLY from a single official source with
 * no competing evidence; disagreement → CONTRADICTED, unofficial-only → UNKNOWN — never silent SAT.
 * The safety constraint is NEVER_RELAX + require-proof, so a non-grounded claim EXCLUDES the SKU.
 */
import assert from "node:assert/strict";
import { isSafetyAxis, resolveSafetyEvidence, safetyConstraintFor } from "../engine/kernel/safety.js";
import { select, NEVER_RELAX } from "../engine/kernel/constraintKernel.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

check("classifies safety-category axes", () => {
  assert.equal(isSafetyAxis({ category: "allergen" }), true);
  assert.equal(isSafetyAxis({ category: "style" }), false);
  assert.equal(isSafetyAxis({}), false);
});

check("single official source, no competing → grounded", () => {
  const r = resolveSafetyEvidence([{ value: "nut-free", official: true, source: "manufacturer" }]);
  assert.equal(r.status, "grounded");
  assert.equal(r.value, "nut-free");
});

check("two official sources disagree → CONTRADICTED (fail closed, never pick one)", () => {
  const r = resolveSafetyEvidence([{ value: "nut-free", official: true }, { value: "contains-nuts", official: true }]);
  assert.equal(r.status, "contradicted");
});

check("only unofficial evidence → UNKNOWN (never a silent SAT)", () => {
  const r = resolveSafetyEvidence([{ value: "nut-free", official: false, source: "a reviewer" }]);
  assert.equal(r.status, "unknown");
});

check("a safety constraint is NEVER_RELAX + require-proof → UNKNOWN excludes the SKU", () => {
  const axis = { id: "allergen", label: "مسبّبات الحساسية", category: "allergen", values: [{ value: "nut-free" }, { value: "contains-nuts" }] };
  const c = safetyConstraintFor(axis);
  assert.equal(c.mode, NEVER_RELAX);
  assert.equal(c.requireProof, true);
  // a product whose allergen claim is UNKNOWN must be excluded when the shopper asks "nut-free"
  const safe = { id: "safe", values: new Map([["allergen", { value: "nut-free", grounded: true }]]) };
  const unknownClaim = { id: "maybe", values: new Map() }; // no grounded allergen claim → UNKNOWN
  const r = select([safe, unknownClaim], [c], { allergen: "nut-free" }, { catalogUrls: new Set(["safe", "maybe"]) });
  assert.equal(r.product_id, "safe", "only the officially-grounded safe product is eligible");
});

if (process.exitCode === 1) console.error("\nFAIL — safety guard is not fail-closed.\n");
else console.log(`\nPASS — all ${passed} safety-guard assertions passed.\n`);
