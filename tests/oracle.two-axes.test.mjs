/**
 * tests/oracle.two-axes.test.mjs — STEP 4-a, the governing TWO-AXES correction (mandatory).
 * ===========================================================================================
 * Two INDEPENDENT axes must never be conflated:
 *   • MATCH CLASSIFICATION (exact / compromise / rejected) — WHO is chosen (kernel + oracle).
 *   • CERTIFICATE STATE   (verified / UNVERIFIED / stale)   — HOW a chosen pick is displayed (render).
 * UNVERIFIED is a CERTIFICATE STATE, not a match class. This proves, against the REAL kernel and the
 * REAL render-time reference monitor (certifyForRender), the two mandatory properties:
 *   (1) a `rejected` (ineligible) candidate NEVER reaches display — by any path.
 *   (2) an eligible pick whose promise cannot be grounded is shown UNVERIFIED WITH DISCLOSURE — it
 *       does NOT disappear and is NOT folded into `rejected`.
 * Read-only: it asserts existing behavior; it does not modify the render layer.
 */
import assert from "node:assert/strict";
import { select, classifyUnit, NEVER_RELAX, RELAXABLE, NO_MATCH, UNVERIFIED } from "../engine/kernel/constraintKernel.js";
import { evaluateState } from "../engine/kernel/authoringOracle/evaluateState.js";
import { certifyForRender, isCertified, isTerminal } from "../engine/kernel/certifyForRender.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const constraints = [
  { id: "type", type: "nominal", mode: NEVER_RELAX, priority: 1 },
  { id: "budget", type: "ordinal", mode: RELAXABLE, priority: 2, order: ["0", "1", "2", "3"] },
];
const U = (id, type, tier) => ({ id, values: { type: { value: type, grounded: true }, budget: { value: tier, grounded: true } } });
// W: right type, but its budget tier is UNGROUNDED → an ungrounded PROMISE → UNVERIFIED (eligible).
const Wunverified = { id: "W", values: { type: { value: "oil", grounded: true }, budget: { value: null, grounded: false } } };
const context = { structural_catalog_version: "cat_1", policy_version: "pol_1", kernel_version: "k_1" };

check("AXIS SEPARATION — an ungrounded-promise pick is UNVERIFIED and classified compromise (NOT rejected)", () => {
  const c = classifyUnit(Wunverified, constraints, { type: "oil", budget: 1 });
  assert.equal(c.matchState, UNVERIFIED, "an ungrounded promise ⇒ UNVERIFIED match state");
  assert.equal(c.klass, "compromise", "UNVERIFIED is eligible ⇒ compromise partition, NEVER rejected");
});

check("(1) REJECTED never reaches selection — select() never chooses an ineligible unit; rejected-only ⇒ NO_MATCH", () => {
  const pool = [U("A", "oil", 0), U("Rspray", "spray", 0)]; // Rspray violates a NEVER_RELAX promise → rejected
  const ev = evaluateState({ units: pool, constraints, answers: { type: "oil", budget: 0 }, context });
  assert.ok(ev.rejected_ids.includes("Rspray"), "the spray is in the rejected partition");
  const r = select(pool, constraints, { type: "oil", budget: 0 }, { catalogUrls: new Set(["A", "Rspray"]) });
  assert.ok(!ev.rejected_ids.includes(r.product_id), "the chosen product is NEVER a rejected candidate");
  // a pool of ONLY rejected candidates ⇒ honest NO_MATCH (product_id null), never a rejected card
  const only = select([U("Rspray2", "spray", 0)], constraints, { type: "oil", budget: 0 }, { catalogUrls: new Set(["Rspray2"]) });
  assert.equal(only.product_id, null);
  assert.equal(only.match_state, NO_MATCH);
});

check("(1b) RENDER — a NO_MATCH terminal draws NO product certificate (rejected never displays)", () => {
  const config = {
    id: "t", scoring: { mode: "decision-table" }, constraintPolicy: [{ id: "type", mode: "NEVER_RELAX", type: "nominal" }],
    catalog_version: "cat_1", policy_version: "pol_1", answer_contract_version: "ans_1", config_hash: "cfg_1", locale_bundle_version: "loc_1",
    archetypes: [{ id: "R1", recommendations: { primary: null, contextual: [] } }],
    decisionTable: [{ id: "r0", kind: "TERMINAL", when: {}, terminal_state: "NO_MATCH", reason_code: "NO_PRODUCT_WITHIN_CONSTRAINTS" }],
  };
  const resolved = { scoring: { ruleId: "r0" }, primary: config.archetypes[0] };
  const cert = certifyForRender(config, resolved, {}, { catalog_version: "cat_1", policy_version: "pol_1", answer_contract_version: "ans_1", config_hash: "cfg_1", locale_bundle_version: "loc_1" });
  assert.ok(isTerminal(cert) && !isCertified(cert), "a NO_MATCH is a terminal — no product card, no certificate");
});

check("(2) RENDER — an UNVERIFIED pick is CERTIFIED and DISPLAYED with disclosure (not a terminal, not hidden)", () => {
  const PROVEN = "https://shop.example/products/w";
  const config = {
    id: "t", scoring: { mode: "decision-table" }, constraintPolicy: [{ id: "type", mode: "NEVER_RELAX", type: "nominal" }],
    catalog_version: "cat_1", policy_version: "pol_1", answer_contract_version: "ans_1", config_hash: "cfg_1", locale_bundle_version: "loc_1",
    archetypes: [{ id: "R1", recommendations: { primary: { name: "W", url: PROVEN, price: 300, image: "" }, contextual: [] } }],
    decisionTable: [{
      id: "r0", kind: "COMMERCE", when: { D_type: "oil" }, result: "R1",
      proof: { product_id: PROVEN, match_state: "UNVERIFIED", conflicts: [], unknowns: [{ axis: "budget", label: "الميزانية" }] },
    }],
  };
  const resolved = { scoring: { ruleId: "r0" }, primary: config.archetypes[0] };
  const V = { catalog_version: "cat_1", policy_version: "pol_1", answer_contract_version: "ans_1", config_hash: "cfg_1", locale_bundle_version: "loc_1" };
  const cert = certifyForRender(config, resolved, {}, V);
  assert.ok(isCertified(cert), "an UNVERIFIED pick is STILL a certificate (it displays)");
  assert.ok(!isTerminal(cert), "it is NOT a terminal — it does not disappear");
  assert.equal(cert.match_state, "UNVERIFIED", "the certificate STATE is UNVERIFIED (the second axis), preserved");
  assert.ok(cert.unknowns.length >= 1 && cert.unknowns[0].axis === "budget", "the disclosure (what is unverified) travels with the card (ق9/ق21)");
});

if (process.exitCode === 1) console.error("\nFAIL — the two axes (match class vs certificate state) were conflated.\n");
else console.log(`\nPASS — all ${passed} two-axes assertions passed.\n`);
