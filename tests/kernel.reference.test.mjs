/**
 * tests/kernel.reference.test.mjs — the independent reference oracle catches every corruption
 * (ADR-0037 closing, BLOCKER-1 / C11). Each mutation below is a way the selection could be wrong;
 * `proveSelection` (which shares ONLY base predicates with the kernel) must reject all seven, and
 * the injection test proves the oracle is genuinely independent — it flags a deliberately wrong
 * chooser, so independence is tested, not asserted.
 */
import assert from "node:assert/strict";
import { proveSelection } from "../engine/kernel/referenceEvaluator.js";
import { select, NEVER_RELAX, RELAXABLE } from "../engine/kernel/constraintKernel.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const flags = (r, crit) => r.findings.some((f) => f.criterion === crit);

const cFormat = { id: "format", label: "الشكل", type: "nominal", mode: NEVER_RELAX, strict: true, priority: 0, order: ["oil", "spray"], requireProof: true };
const cBudget = { id: "budget", label: "الميزانية", type: "ordinal", mode: RELAXABLE, strict: true, priority: 1, order: ["low", "mid", "high"] };
const cChar = { id: "char", label: "الطابع", type: "nominal", mode: RELAXABLE, strict: false, priority: 2, order: ["woody", "floral"] };
const CS = [cFormat, cBudget, cChar];
const mk = (id, f, b, ch) => ({ id, values: new Map([["format", { value: f, grounded: true }], ["budget", { value: b, grounded: true }], ["char", { value: ch, grounded: true }]]) });
const answers = { format: "oil", budget: "mid", char: "woody" };
const B = { maxBudgetOvershootTiers: 3 };

// the honest kernel pick — used as the "correct" claim baseline
function kernelClaim(units) {
  const r = select(units, CS, answers, { catalogUrls: new Set(units.map((u) => u.id)), bounds: B });
  return { product_id: r.product_id, variant_id: r.variant_id, match_state: r.match_state, conflicts: r.conflicts, unknowns: r.unknowns };
}

check("baseline: the kernel's own pick PASSES the independent oracle", () => {
  const units = [mk("exact", "oil", "mid", "woody"), mk("comp", "oil", "high", "woody")];
  const r = proveSelection(units, CS, answers, kernelClaim(units), B);
  assert.ok(r.ok, JSON.stringify(r.findings));
});

check("M1 — winner replaced by a strictly worse SKU → criterion 5", () => {
  const units = [mk("exact", "oil", "mid", "woody"), mk("worse", "oil", "high", "woody")];
  const claim = { product_id: "worse", match_state: "COMPROMISE", conflicts: [{ axis: "budget", dir: "above" }], unknowns: [] };
  const r = proveSelection(units, CS, answers, claim, B);
  assert.ok(flags(r, 5), "must flag a strictly-better unit exists");
});

check("M2 — COMPROMISE chosen although an EXACT exists → criterion 4", () => {
  const units = [mk("exact", "oil", "mid", "woody"), mk("comp", "oil", "high", "woody")];
  const claim = { product_id: "comp", match_state: "COMPROMISE", conflicts: [{ axis: "budget", dir: "above" }], unknowns: [] };
  const r = proveSelection(units, CS, answers, claim, B);
  assert.ok(flags(r, 4) || flags(r, 5), "exact dominance / optimality must fire");
});

check("M3 — UNKNOWN reported as SAT (state lie) → criterion 4", () => {
  const u = { id: "u", values: new Map([["format", { value: "oil", grounded: true }], ["budget", { value: "mid", grounded: true }]]) }; // char UNKNOWN
  const claim = { product_id: "u", match_state: "EXACT", conflicts: [], unknowns: [] }; // lies: really UNVERIFIED
  const r = proveSelection([u], CS, answers, claim, B);
  assert.ok(flags(r, 4), "claimed EXACT ≠ real UNVERIFIED");
  assert.ok(flags(r, 3), "the UNKNOWN must also be flagged as undisclosed");
});

check("M4 — a real conflict deleted from the disclosure → criterion 3", () => {
  const units = [mk("comp", "oil", "high", "woody")]; // only option: budget VIOLATED
  const claim = { product_id: "comp", match_state: "COMPROMISE", conflicts: [], unknowns: [] }; // hides the budget conflict
  const r = proveSelection(units, CS, answers, claim, B);
  assert.ok(flags(r, 3), "undisclosed conflict must be caught");
});

check("M5 — global fallback bypassing NEVER_RELAX → ineligible (criterion 2)", () => {
  const units = [mk("wrongform", "spray", "mid", "woody")]; // violates never-relax format
  const claim = { product_id: "wrongform", match_state: "COMPROMISE", conflicts: [{ axis: "format" }], unknowns: [] };
  const r = proveSelection(units, CS, answers, claim, B);
  assert.ok(flags(r, 2), "a never-relax-violating pick must be rejected as ineligible");
});

check("M6 — coverage/boost picks a worse equal-form unit → criterion 5", () => {
  const units = [mk("near", "oil", "mid", "woody"), mk("far", "oil", "high", "floral")];
  const claim = { product_id: "far", match_state: "COMPROMISE", conflicts: [{ axis: "budget", dir: "above" }, { axis: "char", soft: true }], unknowns: [] };
  const r = proveSelection(units, CS, answers, claim, B);
  assert.ok(flags(r, 5), "a worse boost pick must be caught");
});

check("M7 — variant swapped to a SKU that doesn't satisfy the constraints jointly → criterion 7", () => {
  const cVariant = { id: "size", label: "الحجم", type: "variant", mode: NEVER_RELAX, priority: 3 };
  const CSV = [cFormat, cVariant];
  const unit = { id: "p", values: new Map([["format", { value: "oil", grounded: true }]]),
    variants: [{ id: "sku-3ml", purchasable: true, attributes: { size: "3ml" } }, { id: "sku-6ml", purchasable: true, attributes: { size: "6ml" } }] };
  const ans = { format: "oil", size: { size: "3ml" } };
  const claim = { product_id: "p", variant_id: "sku-6ml", match_state: "EXACT", conflicts: [], unknowns: [] }; // wrong SKU
  const r = proveSelection([unit], CSV, ans, claim, {});
  assert.ok(flags(r, 7), "a variant that doesn't satisfy the answer must be caught");
});

check("INJECTION — a deliberately reversed chooser is flagged by the oracle (independence proven)", () => {
  // a matcher test-double that picks the WORST eligible unit (reverse of the policy).
  function reversedChooser(units) {
    const elig = units; // (all eligible here — same form/grounded)
    // reverse policy: prefer the LARGEST budget distance (worst)
    const dist = (u) => Math.abs(["low", "mid", "high"].indexOf(u.values.get("budget").value) - 1);
    const worst = elig.slice().sort((a, b) => dist(b) - dist(a))[0];
    return { product_id: worst.id, match_state: "COMPROMISE", conflicts: [{ axis: "budget", dir: "above" }], unknowns: [] };
  }
  const units = [mk("best", "oil", "mid", "woody"), mk("worst", "oil", "high", "woody")];
  const bad = reversedChooser(units);
  assert.equal(bad.product_id, "worst", "the double indeed chose the worst");
  const r = proveSelection(units, CS, answers, bad, B);
  assert.ok(!r.ok && flags(r, 5), "the INDEPENDENT oracle must reject the reversed chooser's pick");
  // and it must ACCEPT the correct pick on the same inputs
  const good = proveSelection(units, CS, answers, kernelClaim(units), B);
  assert.ok(good.ok, "the oracle accepts the correct pick — so it is not vacuously rejecting");
});

if (process.exitCode === 1) console.error("\nFAIL — the reference oracle missed a corruption.\n");
else console.log(`\nPASS — all ${passed} reference-oracle assertions passed (7 mutations + injection).\n`);
