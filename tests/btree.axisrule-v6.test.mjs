/**
 * tests/btree.axisrule-v6.test.mjs — AXIS-RULE v6 (consultation round-6). Same expected-residual SCORE; two
 * changes the operator required:
 *   (A) MIRROR guard is DERIVED in the score's own currency — expected residual Σsᵢ²/S < CAP — replacing the
 *       free-floating v5 singleton-share (blind to all-size-2 distributions). Integer: Σsᵢ² < CAP·S. Exempt
 *       when S ≤ CAP. Anchor = leaf_total_cap (leaf_primary_cap=1 is INERT — proven below).
 *   (B) Eligible-drop ACCOUNTING (round-6): every parent-ELIGIBLE candidate stays eligible at ≥1 child OR is
 *       recorded with a NAMED reason; an UNRECORDED drop fails the build (server-side verifyReachability).
 * Red-first: asserts the operator's three mirror tests, the leaf_primary_cap inertness, the v5→v6 gap
 * (all-size-2), the SPARSE-axis /S false-positive (surfaced), and the drop ledger (exact hard vs recorded).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree, RULE_V5, RULE_V6 } from "../authoring/brain2/tree.js";
import { diagnoseAxesV5, diagnoseAxesV6 } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const pol = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "config", "policy.json"), "utf8"));
const MINR = pol.authoring_tree.min_exact_option_ratio, TOTAL = pol.surface.leaf_total_cap, PRIMARY = pol.surface.leaf_primary_cap;
const stat = (sizes, S) => ({ x: { sizes, evidence: S } });
const decideV6 = (sizes, S) => diagnoseAxesV6(stat(sizes, S), { S, minExactRatio: MINR, leafTotalCap: TOTAL }).chosen !== null;

// ── (A) the operator's three mirror tests (anchor = leaf_total_cap) ─────────────────────────────────────
check("mirror test 1: all buckets size 2 (large pool) ⇒ REJECTED (v5 singleton-share was blind to this)", () => {
  assert.equal(decideV6(Array(10).fill(2), 20), false, "Σsᵢ²/S = 40/20 = 2 < 4 ⇒ mirror");
  // the v5 gap it closes: v5 singleton-share = 0 (no size-1 options) ⇒ v5 ACCEPTS the near-mirror
  assert.equal(diagnoseAxesV5(stat(Array(10).fill(2), 20), { S: 20, minExactRatio: MINR, mirrorSingletonShareMax: 0.2, exemptBound: PRIMARY + 1 }).chosen, "x", "v5 wrongly accepts all-size-2");
});
check("mirror test 2: a big bucket + two singletons [10,1,1] ⇒ ACCEPTED", () => {
  assert.equal(decideV6([10, 1, 1], 12), true, "Σsᵢ²/S = 102/12 = 8.5 ≥ 4");
});
check("mirror test 3: an honest final binary (S=2, two singletons) ⇒ ACCEPTED via exemption (S ≤ cap)", () => {
  assert.equal(decideV6([1, 1], 2), true);
});
check("pure mirror (14 singletons) ⇒ REJECTED", () => {
  assert.equal(decideV6(Array(14).fill(1), 14), false, "Σsᵢ²/S = 14/14 = 1 < 4");
});

// ── the anchor deviation, proven: leaf_primary_cap is INERT ─────────────────────────────────────────────
check("ANCHOR: leaf_primary_cap=1 is INERT — the reject criterion fires on NOTHING (fails the operator's own tests)", () => {
  const inert = (sizes, S) => diagnoseAxesV6(stat(sizes, S), { S, minExactRatio: MINR, leafTotalCap: PRIMARY }).chosen !== null;
  assert.equal(PRIMARY, 1, "leaf_primary_cap is 1");
  assert.equal(inert(Array(10).fill(2), 20), true, "with cap=1, all-size-2 is NOT rejected (Σsᵢ²/S=2 ≥ 1) — inert");
  assert.equal(inert(Array(14).fill(1), 14), true, "with cap=1, even a pure mirror is NOT rejected (Σsᵢ²/S=1 ≥ 1) — inert");
});

// ── the DENOMINATOR caveat, surfaced: Σsᵢ²/S false-positives a sparse (large-u₀) legitimate axis ─────────
check("DENOMINATOR caveat (surfaced): a sparse soft axis [6,6] at S=20 (u₀=8) is flagged by /S though /Σsᵢ clears it", () => {
  assert.equal(decideV6([6, 6], 20), false, "Σsᵢ²/S = 72/20 = 3.6 < 4 ⇒ mirror-rejected by the LITERAL /S spec");
  const groundedMetric = 72 / 12; // Σsᵢ²/Σsᵢ = 6 ≥ 4 ⇒ the options do NOT fragment; this is a false positive
  assert.ok(groundedMetric >= TOTAL, "the grounded-denominator metric would CLEAR it — the /S flag is a sparsity false-positive (operator to decide the denominator)");
});

// ── (B) eligible-drop ledger ────────────────────────────────────────────────────────────────────────────
const G = (v) => (v == null ? { value: null, grounded: false } : { value: v, grounded: true });
const LIM = { ...pol.authoring_tree, leaf_primary_cap: pol.surface.leaf_primary_cap };
function synth(typeMode) {
  // 10×t1 + 10×t2 + 2 ungrounded-type — buckets big enough (residual (100+100)/22≈9 ≥ cap) that `type`
  // PASSES the v6 mirror guard and actually branches, so the reachability invariant is exercised.
  const types = [];
  for (let i = 0; i < 10; i++) types.push("t1");
  for (let i = 0; i < 10; i++) types.push("t2");
  types.push(null, null);
  const units = types.map((t, i) => ({ id: `u${i}`, values: { type: G(t), budget: G("mid") } }));
  const resolvedContracts = [
    { axis_id: "type", type: "nominal", mode: typeMode, priority: 1 },
    { axis_id: "budget", type: "ordinal", mode: "RELAXABLE", priority: 2, order: ["low", "mid", "high"], resolved: { thresholds: [1, 2] } },
  ];
  return new AuthoringOracle({ units, resolvedContracts, context: { structural_catalog_version: "syn", policy_version: "syn", kernel_version: "k_1" } });
}
check("LEDGER — EXACT drop is a HARD fail (NEVER_RELAX axis with u₀>0) and is recorded with a named reason", () => {
  const o = synth("NEVER_RELAX");
  const r = o.verifyReachability(buildFullTree(o, { limits: LIM }).nodes);
  assert.equal(r.ok, false, "exact drop ⇒ build fails");
  assert.equal(r.exact_drops, 2, "the 2 ungrounded-type exact units are the drops");
  assert.ok(r.recorded_drops.some((d) => d.reason === "unknown_on_axis:type"), "drop reason is NAMED (not silent): " + JSON.stringify(r.recorded_drops));
  assert.equal(r.unrecorded_eligible_drops, 0, "no unrecorded drop");
});
check("LEDGER — RELAXABLE axis: unknowns compromise into every branch, nothing dropped", () => {
  const o = synth("RELAXABLE");
  const r = o.verifyReachability(buildFullTree(o, { limits: LIM }).nodes);
  assert.equal(r.ok, true); assert.equal(r.exact_drops, 0);
});
check("LEDGER — a COMPROMISE drop is RECORDED (reason named) and ALLOWED (ok), never silent", () => {
  // manual 2-level path: branch origin=o2 (a,U become compromise), then type=t1 (U ungrounded type → dropped
  // as a COMPROMISE, recorded). Only o2 is published — enough to exercise the ledger on the O2 node.
  const units = [{ id: "a", values: { origin: G("o1"), type: G("t1") } }, { id: "b", values: { origin: G("o2"), type: G("t1") } }, { id: "U", values: { origin: G("o1"), type: G(null) } }];
  const o = new AuthoringOracle({ units, resolvedContracts: [{ axis_id: "origin", type: "nominal", mode: "RELAXABLE", priority: 1 }, { axis_id: "type", type: "nominal", mode: "NEVER_RELAX", priority: 2 }], context: { structural_catalog_version: "syn", policy_version: "syn", kernel_version: "k_1" } });
  const root = o.evaluateRoot();
  const o2 = o.publishByRef(root, o.enumerate(root, "origin").find((r) => r.label === "o2").option_ref);
  const o2t1 = o.publishByRef(o2, o.enumerate(o2, "type").find((r) => r.label === "t1").option_ref);
  const r = o.verifyReachability([root, o2, o2t1]);
  assert.equal(r.exact_drops, 0, "U is COMPROMISE at O2 (origin violated), not exact — no hard fail");
  assert.ok(r.recorded_drops.some((d) => d.reason === "unknown_on_axis:type" && d.count === 1), "U's drop recorded: " + JSON.stringify(r.recorded_drops));
  assert.equal(r.unrecorded_eligible_drops, 0);
  assert.equal(r.ok, true, "a recorded compromise drop is allowed (surfaced, not silent)");
});

// ── oud before/after v5 → v6 (reachability + the reported mirror gate-signals) ──────────────────────────
const inputs = await oudOneLevelInputs();
const CAP = inputs.leafCaps.total;
const fresh = () => new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const limits = { ...inputs.treeLimits, leaf_primary_cap: inputs.leafCaps.primary };
function measure(rule) {
  const o = fresh(); const tree = buildFullTree(o, { limits, rule });
  const skusOf = (fams) => fams.flatMap((f) => inputs.skusByFamily[f] || []);
  const cand = new Set(), atCap = new Set();
  for (const leaf of tree.leaves) { for (const s of skusOf(o.membersOf(leaf.pools.eligible_ref))) cand.add(s); const shown = [...o.membersOf(leaf.pools.exact_ref).slice().sort(), ...o.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP); for (const s of skusOf(shown)) atCap.add(s); }
  const comp = tree.leaves.filter((l) => (tree.meta.get(l.evaluation_hash) || {}).compromiseOnly).length;
  return { rule: tree.ruleId, root: tree.internalChoices[0] && tree.internalChoices[0].axisId, depth: tree.depth, nodes: tree.nodes.length, leaves: tree.leaves.length, cand: cand.size, atCap: atCap.size, comp: tree.leaves.length ? Math.round(comp / tree.leaves.length * 100) : 0, reach: o.verifyReachability(tree.nodes), rej: tree.guardRejections || [] };
}
check("OUD before/after v5 → v6: reachability holds; report the mirror gate-signals (all `origin` — /S false-positive)", () => {
  const b = measure(RULE_V5), a = measure(RULE_V6);
  console.log(`  · v5: root=${b.root} depth=${b.depth} nodes=${b.nodes} leaves=${b.leaves} in_pool=${b.cand}/80 surface@cap=${b.atCap}/80 comp=${b.comp}% reachOK=${b.reach.ok}`);
  console.log(`  · v6: root=${a.root} depth=${a.depth} nodes=${a.nodes} leaves=${a.leaves} in_pool=${a.cand}/80 surface@cap=${a.atCap}/80 comp=${a.comp}% reachOK=${a.reach.ok}`);
  console.log(`  · v6 reach ledger: exact_drops=${a.reach.exact_drops} unrecorded=${a.reach.unrecorded_eligible_drops} recorded=${JSON.stringify(a.reach.recorded_drops)}`);
  console.log(`  · v6 mirror gate-signals (${a.rej.length}, reported to authoring): ${[...new Set(a.rej.map((r) => r.axis))].join(",")} — ALL a /S sparsity false-positive (origin is a legit soft axis)`);
  assert.equal(a.reach.ok, true, "v6 reachability + ledger clean on oud (no exact/unrecorded drops)");
  assert.equal(a.cand, 80, "reach unchanged: 80/80");
  assert.ok(a.rej.every((r) => r.axis === "origin"), "every mirror gate-signal on oud is `origin` (the sparse soft axis) — surfaced for the denominator decision");
});

if (process.exitCode === 1) console.error("\nFAIL — axis-rule v6 did not behave as specified.\n");
else console.log(`\nPASS — all ${passed} axis-rule v6 checks passed (derived mirror metric, drop ledger). See surfaced anchor + denominator decisions.\n`);
