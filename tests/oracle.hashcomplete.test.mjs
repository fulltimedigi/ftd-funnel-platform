/**
 * tests/oracle.hashcomplete.test.mjs — STEP 4-a, HASH COMPLETENESS proven MECHANICALLY (not by reflection).
 * ===========================================================================================
 * A `evaluation_hash` is only as sound as the completeness of its inputs. The failure mode is "same
 * hash, different classification" — a hidden input that changes WHO matches but not the identity. So we
 * do NOT argue completeness in prose: we PERTURB each input class in isolation and assert the hash
 * MOVES. Any input that changes matching but not the hash would fail here — a proven hole, not a feared one.
 *
 * COVERED INPUT CLASSES (today's oracle inputs): constraint fields (order, mode), unit grounded values,
 * pool membership, answers, each context version (catalog · policy · kernel), and the merchant price
 * overlay. RECORDED FOR WHEN THEY ENTER THE PIPELINE (consultation round-2, #2): merchant edits (signed
 * exclusions / approved axis roles / evidence grade), and currency/locale normalization — each MUST be
 * folded into the hash AND get a perturbation row here the moment it can influence classification.
 */
import assert from "node:assert/strict";
import { oracleHash } from "../engine/kernel/authoringOracle/hash.js";
import { NEVER_RELAX, RELAXABLE } from "../engine/kernel/constraintKernel.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const constraints = [
  { id: "type", type: "nominal", mode: NEVER_RELAX, priority: 1 },
  { id: "budget", type: "ordinal", mode: RELAXABLE, priority: 2, order: ["0", "1", "2", "3"] },
];
const units = [
  { id: "A", values: { type: { value: "oil", grounded: true }, budget: { value: 0, grounded: true } } },
  { id: "B", values: { type: { value: "oil", grounded: true }, budget: { value: 1, grounded: true } } },
];
const answers = { type: "oil", budget: 0 };
const context = { structural_catalog_version: "cat_1", policy_version: "pol_1", kernel_version: "k_1" };
const base = () => oracleHash({ units, constraints, answers, context });

const clone = (x) => JSON.parse(JSON.stringify(x));
const moves = (label, mutate) => check(`a change to ${label} MOVES the hash`, () => {
  const u = clone(units), c = clone(constraints), a = clone(answers), x = clone(context);
  const arg = { units: u, constraints: c, answers: a, context: x };
  mutate(arg);
  assert.notEqual(oracleHash(arg), base(), `${label} changed classification-relevant input but the hash stayed put — a proven hole`);
});

moves("a constraint field (budget order)", (g) => { g.constraints[1].order = ["3", "2", "1", "0"]; });
moves("a constraint mode (RELAXABLE→NEVER_RELAX)", (g) => { g.constraints[1].mode = NEVER_RELAX; });
moves("a unit grounded value (B's budget tier)", (g) => { g.units[1].values.budget.value = 3; });
moves("a unit grounding flag (B becomes ungrounded)", (g) => { g.units[1].values.budget.grounded = false; });
moves("pool membership (drop unit B)", (g) => { g.units.pop(); });
moves("an answer value (budget 0→1)", (g) => { g.answers.budget = 1; });
moves("context.structural_catalog_version", (g) => { g.context.structural_catalog_version = "cat_2"; });
moves("context.policy_version", (g) => { g.context.policy_version = "pol_2"; });
moves("context.kernel_version", (g) => { g.context.kernel_version = "k_2"; });
check("the merchant price OVERLAY (opts.bounds) MOVES the hash", () => {
  assert.notEqual(oracleHash({ units, constraints, answers, context, opts: { bounds: { maxPriceOvershoot: 0 } } }), base(), "an overlay that changes matching must change the identity");
});

check("a NO-OP (reordering units + constraints) does NOT move the hash (order is not semantics)", () => {
  const shuffled = oracleHash({ units: [units[1], units[0]], constraints: [constraints[1], constraints[0]], answers, context });
  assert.equal(shuffled, base(), "input order must never leak into the evaluation identity");
});

if (process.exitCode === 1) console.error("\nFAIL — an input can change matching without changing the hash (completeness hole).\n");
else console.log(`\nPASS — all ${passed} hash-completeness perturbations behaved correctly.\n`);
