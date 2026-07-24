/**
 * tests/kernel.test.mjs — the constraint kernel, unit level (ADR-0037).
 * Verifies the three-valued predicate, lexicographic partial-CSP selection, exact dominance,
 * never-relax exclusion, three-valued disclosure, and the proof-carrying SelectionResult.
 */
import assert from "node:assert/strict";
import {
  status, select, evaluateUnit, disclose,
  SAT, VIOLATED, UNKNOWN, NEVER_RELAX, RELAXABLE, ADVISORY, EXACT, COMPROMISE, UNVERIFIED, NO_MATCH,
} from "../engine/kernel/constraintKernel.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const cFormat = { id: "format", label: "الشكل", type: "nominal", mode: NEVER_RELAX, strict: true, priority: 0, order: ["oil", "spray", "raw"] };
const cBudget = { id: "budget", label: "الميزانية", type: "ordinal", mode: RELAXABLE, strict: true, priority: 1, order: ["low", "mid", "high"] };
const cChar = { id: "char", label: "الطابع", type: "nominal", mode: RELAXABLE, strict: false, priority: 2, order: ["woody", "floral"] };

check("three-valued status: SAT / VIOLATED / UNKNOWN", () => {
  assert.equal(status(cFormat, "oil", { value: "oil", grounded: true }).state, SAT);
  assert.equal(status(cFormat, "oil", { value: "spray", grounded: true }).state, VIOLATED);
  assert.equal(status(cFormat, "oil", { value: null, grounded: false }).state, UNKNOWN);
  assert.equal(status(cFormat, "oil", { value: "oil", grounded: false }).state, UNKNOWN, "ungrounded is UNKNOWN even if the token matches");
});

check("ordinal magnitude = tier distance; directional", () => {
  assert.equal(status(cBudget, "low", { value: "mid", grounded: true }).magnitude, 1);
  assert.equal(status(cBudget, "low", { value: "high", grounded: true }).magnitude, 2);
  assert.equal(status(cBudget, "mid", { value: "mid", grounded: true }).state, SAT);
});

check("price predicate is directional (≤ cap): under-budget SAT, over-budget grows", () => {
  const cPrice = { id: "p", type: "price", mode: NEVER_RELAX, priority: 0 };
  assert.equal(status(cPrice, { cap: 500 }, { value: 400, grounded: true }).state, SAT);
  assert.equal(status(cPrice, { cap: 500 }, { value: 900, grounded: true }).magnitude, 400);
  assert.equal(status(cPrice, { cap: 500 }, { value: 500, grounded: true }).state, SAT);
});

check("nominal is multi-valued (set intersection)", () => {
  assert.equal(status(cChar, "woody", { value: ["woody", "smoky"], grounded: true }).state, SAT);
  assert.equal(status(cChar, ["woody", "floral"], { value: ["floral"], grounded: true }).state, SAT);
  assert.equal(status(cChar, "woody", { value: ["floral"], grounded: true }).state, VIOLATED);
});

const mk = (id, f, b, ch) => ({ id, values: new Map([["format", { value: f, grounded: true }], ["budget", { value: b, grounded: true }], ["char", { value: ch, grounded: true }]]) });

check("NEVER_RELAX format is excluded, never relaxed", () => {
  const units = [mk("A", "oil", "low", "woody"), mk("B", "spray", "low", "woody")];
  const r = select(units, [cFormat, cBudget, cChar], { format: "spray", budget: "low", char: "woody" }, { catalogUrls: new Set(["A", "B"]) });
  assert.equal(r.product_id, "B", "must pick the spray, never the oil");
  assert.equal(r.match_state, EXACT);
});

check("exact dominance: an EXACT candidate beats any COMPROMISE", () => {
  const units = [mk("exact", "oil", "mid", "woody"), mk("cheap", "oil", "low", "woody")];
  const r = select(units, [cFormat, cBudget, cChar], { format: "oil", budget: "mid", char: "woody" }, { catalogUrls: new Set(["exact", "cheap"]) });
  assert.equal(r.product_id, "exact");
  assert.equal(r.match_state, EXACT);
});

check("budget relaxes to the NEAREST tier when the exact cell is empty; disclosed with direction", () => {
  const units = [mk("mid", "oil", "mid", "woody"), mk("high", "oil", "high", "woody")];
  const r = select(units, [cFormat, cBudget, cChar], { format: "oil", budget: "low", char: "woody" }, { catalogUrls: new Set(["mid", "high"]), bounds: { maxBudgetOvershootTiers: 3 } });
  assert.equal(r.product_id, "mid", "nearest tier (mid is 1 away, high is 2)");
  assert.equal(r.match_state, COMPROMISE);
  const budgetConflict = r.conflicts.find((c) => c.axis === "budget");
  assert.ok(budgetConflict, "budget relaxation is disclosed");
  assert.equal(budgetConflict.dir, "above");
});

check("UNKNOWN → UNVERIFIED state and an unknown disclosure (never silent)", () => {
  const u = { id: "U", values: new Map([["format", { value: "oil", grounded: true }], ["budget", { value: "low", grounded: true }]]) }; // no char
  const r = select([u], [cFormat, cBudget, cChar], { format: "oil", budget: "low", char: "woody" }, { catalogUrls: new Set(["U"]) });
  assert.equal(r.product_id, "U");
  assert.equal(r.match_state, UNVERIFIED);
  assert.ok(r.unknowns.find((x) => x.axis === "char"), "the unverified attribute is disclosed as UNKNOWN, not a match");
  assert.equal(r.conflicts.length, 0);
});

check("disclosure is a FRESH re-comparison of the chosen unit to every answer", () => {
  const u = mk("X", "oil", "high", "floral");
  const perC = evaluateUnit(u, [cFormat, cBudget, cChar], { format: "oil", budget: "low", char: "woody" });
  const d = disclose(u, [cFormat, cBudget, cChar], { format: "oil", budget: "low", char: "woody" }, perC);
  assert.equal(d.matches.length, 1, "format matches");
  assert.ok(d.conflicts.find((c) => c.axis === "budget"));
  assert.ok(d.conflicts.find((c) => c.axis === "char"));
});

check("no survivor under NEVER_RELAX → honest NO_MATCH (product_id null), not a fake card", () => {
  const units = [mk("A", "oil", "low", "woody")];
  const r = select(units, [cFormat, cBudget, cChar], { format: "spray", budget: "low", char: "woody" }, { catalogUrls: new Set(["A"]) });
  assert.equal(r.product_id, null);
  assert.equal(r.match_state, NO_MATCH);
});

check("SelectionResult is frozen and proof-carrying", () => {
  const r = select([mk("A", "oil", "low", "woody")], [cFormat], { format: "oil" }, { catalogUrls: new Set(["A"]), catalogVersion: "cat_x", policyVersion: "pol_y" });
  assert.equal(r.catalog_version, "cat_x");
  assert.equal(r.policy_version, "pol_y");
  assert.ok(Object.isFrozen(r));
  assert.throws(() => { r.product_id = "hacked"; }, "result is immutable");
});

if (process.exitCode === 1) console.error("\nFAIL — kernel unit tests broken.\n");
else console.log(`\nPASS — all ${passed} kernel unit assertions passed.\n`);
