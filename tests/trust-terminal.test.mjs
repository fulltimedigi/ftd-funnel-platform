/**
 * tests/trust-terminal.test.mjs — the DISCRIMINATED UNION teeth (ADR-0039).
 * ===========================================================================================
 * The ONE authorized trust change made trustValidate understand honest TERMINAL endings WITHOUT
 * softening its teeth. A validator that accepts a blank screen, an action-less terminal, a
 * proofless COMMERCE, or a global product fallback is worthless — so each of those must still FAIL,
 * while a real honest ending PASSES. Plus: UNVERIFIED stays a valid COMMERCE result (never rejected,
 * never turned terminal); a missing/edited answer resolves to RESTART_REQUIRED (never a product);
 * and the budget policy (=1 tier) is enforced by the INDEPENDENT verifier regardless of the matcher.
 *
 * Base config = a real authored funnel (trust-green). Each tooth clones + mutates it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { authorFunnel } from "../authoring/author/index.js";
import { trustValidate } from "../engine/trustValidate.js";
import { decide } from "../engine/decide.js";
import { proveSelection } from "../engine/kernel/referenceEvaluator.js";
import { NEVER_RELAX, RELAXABLE } from "../engine/kernel/constraintKernel.js";
import { maxBudgetTierDistance } from "../engine/kernel/policyRegistry.js";
import { certifyForRender, isTerminal, isCertified } from "../engine/kernel/certifyForRender.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const blockers = (r) => r.findings.filter((f) => f.severity === "blocker").map((f) => f.code);

const CAT = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/oud-shaped.synthetic.json", import.meta.url)), "utf8"));
const GEN = authorFunnel(CAT, { brandName: "Oud" });
assert.equal(GEN.ok, true, "base fixture authors OK");
const clone = () => JSON.parse(JSON.stringify(GEN.config));
const commerceRuleId = GEN.config.decisionTable.find((r) => r.kind === "COMMERCE" && r.proof).id;
const defaultRuleId = GEN.config.decisionTable.find((r) => r.when && !Object.keys(r.when).length).id;

/* ─────────────────────────────────────────────── A. TRUST TEETH (discriminated union) */
console.log("\nTrust teeth — the discriminated union keeps its teeth (ADR-0039):");

check("BASE: the authored funnel passes trust with ZERO blockers", () => {
  const r = trustValidate(GEN.config);
  assert.equal(r.ok, true, JSON.stringify(r.findings.filter((f) => f.severity === "blocker")));
});

check("1. an honest NO_MATCH terminal (state+reason+message+next_action+terminal_proof) PASSES", () => {
  const cfg = clone();
  const combo = cfg.decisionTable.find((r) => r.kind === "COMMERCE");
  // replace a COMMERCE cell with a well-formed NO_MATCH terminal on the SAME when
  cfg.decisionTable = cfg.decisionTable.map((r) => r.id !== combo.id ? r : {
    id: r.id, kind: "TERMINAL", when: r.when,
    terminal_state: "NO_MATCH", reason_code: "NO_PRODUCT_WITHIN_CONSTRAINTS",
    message_key: "terminal.no_match", next_action: "EDIT_ANSWERS",
    terminal_proof: { product_id: null, policy_hash: "p", tie_break_reason: "no eligible unit within the 1-tier budget bound" },
  });
  const r = trustValidate(cfg);
  assert.equal(r.ok, true, "a complete honest terminal is a trusted outcome: " + JSON.stringify(blockers(r)));
});

check("2. a TERMINAL with NO next_action FAILS (a blank/action-less screen is a dead-end)", () => {
  const cfg = clone();
  const combo = cfg.decisionTable.find((r) => r.kind === "COMMERCE");
  cfg.decisionTable = cfg.decisionTable.map((r) => r.id !== combo.id ? r : {
    id: r.id, kind: "TERMINAL", when: r.when, terminal_state: "NO_MATCH",
    reason_code: "X", message_key: "k", /* next_action MISSING */
    terminal_proof: { product_id: null },
  });
  const r = trustValidate(cfg);
  assert.equal(r.ok, false);
  assert.ok(blockers(r).includes("TV_TERMINAL_NO_ACTION"), blockers(r).join(","));
});

check("2b. a NO_MATCH terminal with NO terminal_proof FAILS (must prove no candidate)", () => {
  const cfg = clone();
  const combo = cfg.decisionTable.find((r) => r.kind === "COMMERCE");
  cfg.decisionTable = cfg.decisionTable.map((r) => r.id !== combo.id ? r : {
    id: r.id, kind: "TERMINAL", when: r.when, terminal_state: "NO_MATCH",
    reason_code: "X", message_key: "k", next_action: "EDIT_ANSWERS", /* terminal_proof MISSING */
  });
  const r = trustValidate(cfg);
  assert.ok(blockers(r).includes("TV_TERMINAL_NO_PROOF"), blockers(r).join(","));
});

check("2c. a TERMINAL carrying a product/CTA FAILS (a terminal must never sell)", () => {
  const cfg = clone();
  const combo = cfg.decisionTable.find((r) => r.kind === "COMMERCE");
  cfg.decisionTable = cfg.decisionTable.map((r) => r.id !== combo.id ? r : {
    id: r.id, kind: "TERMINAL", when: r.when, terminal_state: "RESTART_REQUIRED",
    reason_code: "X", message_key: "k", next_action: "START_OVER", result: combo.result, // ← a product!
  });
  const r = trustValidate(cfg);
  assert.ok(blockers(r).includes("TV_TERMINAL_HAS_PRODUCT"), blockers(r).join(","));
});

check("3. a COMMERCE rule with NO ProvenSelection FAILS", () => {
  const cfg = clone();
  const rule = cfg.decisionTable.find((r) => r.id === commerceRuleId);
  delete rule.proof; // strip the proof → a proofless product claim
  const r = trustValidate(cfg);
  assert.equal(r.ok, false);
  assert.ok(blockers(r).includes("TV1_COMMERCE_NO_PROOF"), blockers(r).join(","));
});

check("4. a when:{} COMMERCE default FAILS (a global product fallback is forbidden)", () => {
  const cfg = clone();
  const dflt = cfg.decisionTable.find((r) => r.id === defaultRuleId);
  const commerce = cfg.decisionTable.find((r) => r.kind === "COMMERCE");
  dflt.kind = "COMMERCE"; dflt.result = commerce.result; dflt.proof = commerce.proof; // fabricate a global fallback
  delete dflt.terminal_state; delete dflt.next_action; delete dflt.reason_code; delete dflt.message_key;
  const r = trustValidate(cfg);
  assert.equal(r.ok, false);
  assert.ok(blockers(r).includes("TV1_DEFAULT_COMMERCE"), blockers(r).join(","));
});

check("7. UNVERIFIED is a VALID COMMERCE result — never rejected, never turned terminal", () => {
  const cfg = clone();
  const rule = cfg.decisionTable.find((r) => r.id === commerceRuleId);
  rule.proof.match_state = "UNVERIFIED"; // a real product with disclosed-uncertain attributes
  rule.proof.unknowns = [{ axis: "character", label: "الطابع" }];
  const r = trustValidate(cfg);
  assert.equal(r.ok, true, "UNVERIFIED must pass as COMMERCE: " + JSON.stringify(blockers(r)));
  // and it stays a COMMERCE product route, not a terminal:
  assert.equal(rule.kind, "COMMERCE");
  assert.ok(rule.result, "still routes to a real product");
});

check("10. a REAL dead-end still FAILS (a COMMERCE rule to a missing archetype)", () => {
  const cfg = clone();
  const rule = cfg.decisionTable.find((r) => r.id === commerceRuleId);
  rule.result = "GHOST_ARCHETYPE_THAT_DOES_NOT_EXIST";
  const r = trustValidate(cfg);
  assert.equal(r.ok, false);
  assert.ok(blockers(r).includes("TV1_RESULT_MISSING"), blockers(r).join(","));
});

/* ─────────────────────────────────────────────── B. DECIDE → honest terminal, never a product */
console.log("\ndecide() — a missing/edited answer resolves to an honest terminal, never a product:");

check("6. no rule matches (missing/edited answer) → RESTART_REQUIRED, no product", () => {
  const table = GEN.config.decisionTable;
  const { result, kind, terminal } = decide({ /* empty signals — nothing matches a combo */ }, table);
  assert.equal(result, null, "no product");
  assert.equal(kind, "TERMINAL");
  assert.equal(terminal.terminal_state, "RESTART_REQUIRED");
  assert.equal(terminal.next_action, "START_OVER");
});

check("6b. a fired TERMINAL rule yields kind=TERMINAL with no result", () => {
  const table = [
    { id: "t", kind: "TERMINAL", when: { D_x: "a" }, terminal_state: "NO_MATCH", next_action: "EDIT_ANSWERS", reason_code: "r", message_key: "k", terminal_proof: { product_id: null } },
    { id: "d", kind: "TERMINAL", when: {}, terminal_state: "RESTART_REQUIRED", next_action: "START_OVER" },
  ];
  const out = decide({ D_x: "a" }, table);
  assert.equal(out.kind, "TERMINAL");
  assert.equal(out.result, null);
  assert.equal(out.terminal.terminal_state, "NO_MATCH");
});

/* ─────────────────────────────────────────────── C. BUDGET POLICY INDEPENDENCE (verifier reads =1) */
console.log("\nBudget policy — the INDEPENDENT verifier enforces =1 tier regardless of the matcher:");

const cFormat = { id: "format", label: "F", type: "nominal", mode: NEVER_RELAX, strict: true, priority: 0, order: ["oil", "spray"] };
const cBudget = { id: "budget", label: "B", type: "ordinal", mode: RELAXABLE, strict: true, priority: 1, order: ["low", "mid", "high"] };
const CS = [cFormat, cBudget];
const mk = (id, f, b) => ({ id, values: new Map([["format", { value: f, grounded: true }], ["budget", { value: b, grounded: true }]]) });
const answers = { format: "oil", budget: "high" }; // shopper asked for high

check("5. a >1-tier overshoot draws NO product — the only unit is over-cap → NO_MATCH is provable", () => {
  assert.equal(maxBudgetTierDistance(), 1, "policy is 1 tier");
  const units = [mk("only", "oil", "low")]; // low vs high = 2 tiers > 1 → ineligible
  // claiming NO_MATCH (product_id null) is VALID because no eligible unit exists within the policy:
  const noMatch = proveSelection(units, CS, answers, { product_id: null });
  assert.ok(noMatch.ok, "NO_MATCH is proven when the only unit is over the 1-tier cap: " + JSON.stringify(noMatch.findings));
});

check("9-budget. FAULT INJECTION: a matcher that over-relaxed (2 tiers) is REJECTED by the verifier", () => {
  const units = [mk("over", "oil", "low")]; // 2 tiers from high
  // a loose matcher (e.g. bound = tierCount) would route "over" as a COMPROMISE. The independent
  // verifier reads maxBudgetTierDistance()=1 from the registry and rejects it as INELIGIBLE — proving
  // no effective bound is inherited from the matcher (audit #6).
  const overClaim = { product_id: "over", match_state: "COMPROMISE", conflicts: [{ axis: "budget", dir: "below" }], unknowns: [] };
  const r = proveSelection(units, CS, answers, overClaim);
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.criterion === 2), "over-cap pick must be flagged INELIGIBLE (criterion 2): " + JSON.stringify(r.findings));
});

check("10b. a FABRICATED NO_MATCH is caught — claiming NO_MATCH while an eligible unit exists FAILS", () => {
  const units = [mk("exact", "oil", "high")]; // an EXACT unit exists
  const r = proveSelection(units, CS, answers, { product_id: null }); // lies: says no match
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.criterion === 6), "a fabricated dead-end (real eligible unit exists) must be caught");
});

/* ─────────────────────────────────────────────── D. certifyForRender maps a fired TERMINAL rule */
console.log("\ncertifyForRender — a fired TERMINAL rule renders its state + next_action, never a product:");

check("8a. a fired NO_MATCH terminal rule → a terminal outcome (no certificate, no product)", () => {
  const cfg = clone();
  const combo = cfg.decisionTable.find((r) => r.kind === "COMMERCE");
  cfg.decisionTable = cfg.decisionTable.map((r) => r.id !== combo.id ? r : {
    id: r.id, kind: "TERMINAL", when: r.when, terminal_state: "NO_MATCH",
    reason_code: "NO_PRODUCT_WITHIN_CONSTRAINTS", message_key: "terminal.no_match", next_action: "EDIT_ANSWERS",
    terminal_proof: { product_id: null },
  });
  const resolved = { scoring: { ruleId: combo.id }, primary: cfg.archetypes.find((a) => a.id === combo.result) };
  const out = certifyForRender(cfg, resolved, {}, {
    catalog_version: cfg.catalog_version, policy_version: cfg.policy_version,
    answer_contract_version: cfg.answer_contract_version, config_hash: cfg.config_hash, locale_bundle_version: cfg.locale_bundle_version,
  });
  assert.ok(isTerminal(out), "a fired TERMINAL certifies to a terminal outcome");
  assert.ok(!isCertified(out), "never a product certificate");
  assert.equal(out.terminal, "NO_MATCH");
  assert.equal(out.next_action, "EDIT_ANSWERS", "the renderer gets an actionable next step");
});

if (process.exitCode === 1) console.error("\nFAIL — a discriminated-union tooth is missing.\n");
else console.log(`\nPASS — all ${passed} trust-terminal (discriminated-union) assertions passed.\n`);
