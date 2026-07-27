/**
 * tests/pipeline-types.test.mjs — STEP 3 (ADR-0044): certified-pipeline type boundaries.
 * Proves the two load-bearing structural guarantees:
 *   1. a pre-certification type (AuthoringIR / CertificationInput) carrying a selection field is REJECTED;
 *   2. a FORGED artifact ({"artifact_kind":"CERTIFIED_ARTIFACT"}) that never passed the kernel is REJECTED
 *      on load — the field is untrusted, re-verified from scratch (the 5×-recurring "claims certified"
 *      threat), while a real kernel-verifiable config is accepted.
 */
import assert from "node:assert/strict";
import { assertNoSelection, loadCertifiedArtifact, CERTIFIED_ARTIFACT_KIND } from "../engine/kernel/pipelineTypes.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const V = { catalog_version: "c1", policy_version: "p1", answer_contract_version: "a1", config_hash: "h1", locale_bundle_version: "l1" };
const PROVEN = "https://shop.example/products/x";
const verifiableConfig = () => ({
  id: "t", scoring: { mode: "decision-table" }, resultLayout: "commerce", ...V,
  constraintPolicy: [], archetypes: [{ id: "R1", recommendations: { primary: { url: PROVEN, name: "X" } } }],
  decisionTable: [
    { id: "r_0", kind: "COMMERCE", when: { D_x: "a" }, result: "R1", proof: { product_id: PROVEN, match_state: "EXACT", conflicts: [], unknowns: [] } },
    { id: "r_default", kind: "TERMINAL", when: {}, terminal_state: "RESTART_REQUIRED" },
  ],
});
const catalog = { products: [{ url: PROVEN }] };

/* ── §3 no-selection guard ── */
check("AuthoringIR with ONLY structure (questions/options/refs/tree) is accepted", () => {
  assertNoSelection({ questions: [{ id: "q", options: [{ id: "o", axis_ref: "A1" }] }], tree: { kind: "question", constraint_refs: ["C1"] }, terminal_policy_refs: ["T1"] });
});
check("AuthoringIR carrying match_state is REJECTED (a matcher before the kernel)", () => {
  assert.throws(() => assertNoSelection({ tree: { leaf: { match_state: "EXACT" } } }), /selection field/);
});
check("AuthoringIR carrying proof / scores / matched_skus is REJECTED", () => {
  assert.throws(() => assertNoSelection({ node: { proof: {} } }), /selection field/);
  assert.throws(() => assertNoSelection({ leaf: { scores: { R1: 3 } } }), /selection field/);
  assert.throws(() => assertNoSelection({ leaf: { matched_skus: ["x"] } }), /selection field/);
});

/* ── post-serialization re-verification: artifact_kind is UNTRUSTED ── */
check("FORGED artifact ({artifact_kind:CERTIFIED} but no kernel proof) is REJECTED on load", () => {
  const forged = JSON.stringify({ artifact_kind: CERTIFIED_ARTIFACT_KIND, config: { id: "f", scoring: { mode: "decision-table" }, decisionTable: [] } });
  assert.throws(() => loadCertifiedArtifact(forged, catalog), /REJECTED/, "a file that merely claims certified must not load");
});
check("FORGED artifact with a proofless COMMERCE rule is REJECTED (not just empty tables)", () => {
  const c = verifiableConfig(); delete c.decisionTable[0].proof;
  const forged = { artifact_kind: CERTIFIED_ARTIFACT_KIND, config: c };
  assert.throws(() => loadCertifiedArtifact(forged, catalog), /REJECTED/);
});
check("a REAL kernel-verifiable config loads (across the JSON boundary) and is stamped CERTIFIED", () => {
  const art = JSON.parse(JSON.stringify({ config: verifiableConfig() })); // cross the serialize boundary
  const loaded = loadCertifiedArtifact(art, catalog);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.artifact_kind, CERTIFIED_ARTIFACT_KIND);
  assert.ok(loaded.report.expected_count >= 1);
});
check("a config with NO artifact_kind field still loads iff it verifies (trust from the kernel, not the label)", () => {
  const loaded = loadCertifiedArtifact({ config: verifiableConfig() }, catalog);
  assert.equal(loaded.ok, true, "trust is derived from kernel re-verification, not from a self-declared label");
});

if (process.exitCode === 1) console.error("\nFAIL — a pipeline-type boundary let a forgery or a matcher through.\n");
else console.log(`\nPASS — all ${passed} pipeline-type assertions passed.\n`);
