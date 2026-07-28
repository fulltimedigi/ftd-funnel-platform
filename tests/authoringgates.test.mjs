/**
 * tests/authoringgates.test.mjs — PHASE-A authoring gates as RELATIONS (consultation round-8). Mirror is a
 * semantic judgment made HERE, where the axis VALUES / their evidence BASIS / their SUPPORT are visible —
 * never a free ratio. Verifies: name_token∧support==1 drops a value (a product name), all-dropped drops the
 * axis, |distinct|==|grounded| rejects the axis (a naming of products), title-resemblance → review not
 * rejection, and a healthy axis passes untouched.
 */
import assert from "node:assert/strict";
import { gateAxisCandidate } from "../authoring/brain2/authoringGates.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

check("RELATION: basis==name_token ∧ support==1 ⇒ the value is a product NAME, dropped (axis survives if others hold)", () => {
  const r = gateAxisCandidate({ axis_key: "mix", values: [
    { value: "Midnight Oud", families: ["f1"], basis: "name_token" },      // a product name → dropped
    { value: "woody", families: ["f2", "f3", "f4"], basis: "structured" }, // a real value → kept
    { value: "fresh", families: ["f5", "f6"], basis: "structured" },
  ] });
  assert.ok(r.rejectedValues.some((v) => v.value === "Midnight Oud"), "the name_token/support-1 value is dropped");
  assert.equal(r.kept.length, 2);
  assert.equal(r.axisRejected, null, "the axis survives on its real values");
});

check("RELATION: every value is name_token∧support==1 ⇒ the WHOLE axis drops", () => {
  const r = gateAxisCandidate({ axis_key: "name", values: [
    { value: "Aventus", families: ["a"], basis: "name_token" },
    { value: "Sauvage", families: ["b"], basis: "name_token" },
  ] });
  assert.equal(r.kept.length, 0);
  assert.ok(r.axisRejected && /all values dropped/.test(r.axisRejected.reason));
});

check("SEMANTIC-TYPE HOMOGENEITY: a product-line disguised as an origin value (katana, 2 SKU/line) ⇒ axis REJECTED regardless of counts", () => {
  // THE katana case: escapes all three counting layers (support=2, |values|≠|products|). Only the
  // semantic-type guard catches it: 'hindi' is an origin, 'katana' is a product line — two dimensions.
  const r = gateAxisCandidate({ axis_key: "origin", values: [
    { value: "hindi", families: ["f1", "f2"], basis: "structured", semantic_type: "origin" },
    { value: "borneo", families: ["f3", "f4"], basis: "structured", semantic_type: "origin" },
    { value: "katana", families: ["f5", "f6"], basis: "name_token", semantic_type: "product_line" }, // 2 SKU/line
  ] });
  assert.ok(r.axisRejected && /semantic-type mix/.test(r.axisRejected.reason), "caught by the type guard, not by counts: " + JSON.stringify(r.axisRejected));
});

check("EVIDENCE-BASIS: all values product-identity-derived (name_token/title token) ⇒ a NAMING ⇒ axis rejected", () => {
  const r = gateAxisCandidate({ axis_key: "sku", values: [
    { value: "v1", families: ["p1"], basis: "title token", semantic_type: "name" },
    { value: "v2", families: ["p2"], basis: "title token", semantic_type: "name" },
    { value: "v3", families: ["p3"], basis: "title token", semantic_type: "name" },
  ] });
  assert.ok(r.axisRejected && /naming/.test(r.axisRejected.reason), JSON.stringify(r));
});

check("EVIDENCE-BASIS: a UNIQUE-per-product axis on an INDEPENDENT vocabulary (variant option) ⇒ ACCEPTED (count-equality is only a signal)", () => {
  // each value unique to one product, 1:1 — but the vocabulary (colors) is catalog-independent (a variant
  // option), so it is a REAL axis. It must NOT be rejected; count-equality is a reported signal; the brain
  // routes it to a display mode.
  const r = gateAxisCandidate({ axis_key: "color", values: [
    { value: "red", families: ["p1"], basis: "variant_option", semantic_type: "color" },
    { value: "green", families: ["p2"], basis: "variant_option", semantic_type: "color" },
    { value: "blue", families: ["p3"], basis: "variant_option", semantic_type: "color" },
  ] });
  assert.equal(r.axisRejected, null, "an independent vocabulary is a real axis even if unique-per-product");
  assert.ok(r.signals.some((s) => s.signal === "count_equality"), "count-equality is reported as a signal, not a rejection");
  assert.equal(r.kept.length, 3);
});

check("REVIEW not rejection: a value resembling its product title ⇒ ق19 merchant review queue", () => {
  const r = gateAxisCandidate({ axis_key: "fam", values: [
    { value: "borneo", families: ["f1", "f2"], basis: "structured", title: "Wild Borneo Oud Oil" }, // resembles → review
    { value: "indian", families: ["f3", "f4"], basis: "structured", title: "Royal Agarwood" },
  ] });
  assert.ok(r.reviewValues.some((v) => v.value === "borneo"), "flagged for review");
  assert.ok(!r.rejectedValues.length, "review is NOT an automatic rejection");
  assert.equal(r.axisRejected, null);
  assert.equal(r.kept.length, 2, "both values kept (review is advisory)");
});

check("a HEALTHY axis (structured basis, support>1, distinct < grounded) passes untouched", () => {
  const r = gateAxisCandidate({ axis_key: "type", values: [
    { value: "oil", families: ["a", "b", "c", "d"], basis: "structured" },
    { value: "perfume", families: ["e", "f", "g"], basis: "structured" },
  ] });
  assert.equal(r.axisRejected, null);
  assert.equal(r.rejectedValues.length, 0);
  assert.equal(r.reviewValues.length, 0);
  assert.equal(r.kept.length, 2);
});

if (process.exitCode === 1) console.error("\nFAIL — authoring gates did not behave as specified.\n");
else console.log(`\nPASS — all ${passed} authoring-gate checks passed (relations, not ratios; drop / reject / review).\n`);
