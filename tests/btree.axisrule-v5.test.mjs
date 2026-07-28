/**
 * tests/btree.axisrule-v5.test.mjs — AXIS-RULE v5 (consultation round-5). Same expected-residual SCORE as v4;
 * v5 adds three hardened invariants the operator required:
 *   (1) PARTITION invariant Σsᵢ+u₀=S per axis (else cross-axis denominator undefined → throws).
 *   (2) u₀-REACHABILITY (server-side oracle.verifyReachability): u₀>0 ⇒ a PUBLISHED option must reach the u₀
 *       units; a NEVER_RELAX axis with u₀>0 drops them from every branch (ق2 dead-end) → build fails.
 *   (3) MIRROR guard is now PER-OPTION (singleton share over the exact pool), not median/density — which a
 *       minority of planted singletons evaded; and it is EXEMPT on a tiny pool (an honest final binary).
 * Red-first: asserts the v4 MISS (v4 chooses the mirror-ish axis) and the v5 FIX (v5 rejects it), plus the
 * reachability invariant catching a real drop, plus oud before/after v4→v5.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree, RULE_V4, RULE_V5 } from "../authoring/brain2/tree.js";
import { diagnoseAxesV4, diagnoseAxesV5 } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const pol = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "config", "policy.json"), "utf8"));
const MINR = pol.authoring_tree.min_exact_option_ratio, MSS = pol.authoring_tree.mirror_singleton_share_max;
const EX = pol.surface.leaf_primary_cap + 1; // exemption bound

// ── (3) reformed MIRROR guard ─────────────────────────────────────────────────────────────────────────
const mirrorish = [3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1]; // 6 legit buckets + 5 planted singletons: Σ=23, share=5/23≈0.217
check("v4 MISSED it: median/density guard lets the mirror-ish axis through — and even PREFERS it", () => {
  const d = diagnoseAxesV4({ m: { sizes: mirrorish, evidence: 23 }, g: { sizes: [12, 11], evidence: 23 } }, { S: 23, minExactRatio: MINR, mirrorDensityMax: 0.5 });
  assert.equal(d.chosen, "m", "v4 picks the mirror-ish axis (lower Σsᵢ²): median=3 & density=0.478 both look innocent");
});
check("v5 FIX: per-option singleton-share rejects the mirror-ish axis BY NAME; the grouping axis wins", () => {
  const d = diagnoseAxesV5({ m: { sizes: mirrorish, evidence: 23 }, g: { sizes: [12, 11], evidence: 23 } }, { S: 23, minExactRatio: MINR, mirrorSingletonShareMax: MSS, exemptBound: EX });
  assert.equal(d.chosen, "g");
  assert.ok(d.rejected.some((r) => r.ax === "m" && r.reason.startsWith("mirror:singleton-share")), "m rejected by singleton share: " + JSON.stringify(d.rejected));
});
check("v5 EXEMPTION: an honest final binary (S=2, two singletons) is NOT rejected — but S=3 all-singletons is", () => {
  const two = { t: { sizes: [1, 1], evidence: 2 } };
  assert.equal(diagnoseAxesV5(two, { S: 2, minExactRatio: MINR, mirrorSingletonShareMax: MSS, exemptBound: EX }).chosen, "t", "S=2 ≤ exemptBound → asked");
  assert.equal(diagnoseAxesV5(two, { S: 2, minExactRatio: MINR, mirrorSingletonShareMax: MSS, exemptBound: 1 }).chosen, null, "without the exemption the same binary would be wrongly rejected (the v4-on-tiny-pool bug)");
  const three = { t: { sizes: [1, 1, 1], evidence: 3 } };
  assert.equal(diagnoseAxesV5(three, { S: 3, minExactRatio: MINR, mirrorSingletonShareMax: MSS, exemptBound: EX }).chosen, null, "S=3 all-singletons > exemptBound → a grid, not a mirror question");
});
check("v5 PARTITION invariant: Σsᵢ > S throws (cross-axis denominator would be undefined)", () => {
  assert.throws(() => diagnoseAxesV5({ x: { sizes: [4, 4], evidence: 8 } }, { S: 6 }), /partition invariant/);
});

// ── (2) u₀-REACHABILITY invariant ─────────────────────────────────────────────────────────────────────
const G = (v) => (v == null ? { value: null, grounded: false } : { value: v, grounded: true });
function synth(typeMode) {
  // 4 grounded-type units (t1,t1,t2,t2) + 2 UNGROUNDED-type units; budget single-value ("mid") so only type branches.
  const tuples = [["t1", 0], ["t1", 1], ["t2", 2], ["t2", 3], [null, 4], [null, 5]];
  const units = tuples.map(([t, i]) => ({ id: `u${i}`, values: { type: G(t), budget: G("mid") } }));
  const resolvedContracts = [
    { axis_id: "type", type: "nominal", mode: typeMode, priority: 1 },
    { axis_id: "budget", type: "ordinal", mode: "RELAXABLE", priority: 2, order: ["low", "mid", "high"], resolved: { thresholds: [1, 2] } },
  ];
  return new AuthoringOracle({ units, resolvedContracts, context: { structural_catalog_version: "syn", policy_version: "syn", kernel_version: "k_1" } });
}
const LIM = { ...pol.authoring_tree, leaf_primary_cap: pol.surface.leaf_primary_cap };

check("REACHABILITY FAILS (build rejected): branching a NEVER_RELAX axis with u₀>0 drops the ungrounded units", () => {
  const o = synth("NEVER_RELAX");
  const tree = buildFullTree(o, { limits: LIM });
  const r = o.verifyReachability(tree.nodes);
  assert.equal(r.ok, false, "verifyReachability must FAIL — the 2 ungrounded-type units are in no branch");
  assert.equal(r.findings.reduce((a, f) => a + f.lost_count, 0), 2, "exactly the 2 ungrounded-type units are lost");
});
check("REACHABILITY PASSES when the same axis is RELAXABLE (unknowns compromise into every branch)", () => {
  const o = synth("RELAXABLE");
  const tree = buildFullTree(o, { limits: LIM });
  assert.equal(o.verifyReachability(tree.nodes).ok, true, "RELAXABLE unknowns are covered by every child → no drop");
});

// ── oud: reachability guardrail + before/after v4 → v5 ─────────────────────────────────────────────────
const inputs = await oudOneLevelInputs();
const CAP = inputs.leafCaps.total;
const fresh = () => new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const limits = { ...inputs.treeLimits, leaf_primary_cap: inputs.leafCaps.primary };

function measure(rule) {
  const o = fresh();
  const tree = buildFullTree(o, { limits, rule });
  const skusOf = (fams) => fams.flatMap((f) => inputs.skusByFamily[f] || []);
  const cand = new Set(), atCap = new Set();
  for (const leaf of tree.leaves) {
    for (const s of skusOf(o.membersOf(leaf.pools.eligible_ref))) cand.add(s);
    const shown = [...o.membersOf(leaf.pools.exact_ref).slice().sort(), ...o.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP);
    for (const s of skusOf(shown)) atCap.add(s);
  }
  const comp = tree.leaves.filter((l) => (tree.meta.get(l.evaluation_hash) || {}).compromiseOnly).length;
  const root = o.evaluateRoot(); const rootStats = {};
  for (const ax of o.axisIds()) { const refs = o.enumerate(root, ax); if (refs.length) rootStats[ax] = { sizes: refs.map((r) => o.probeByRef(root, r.option_ref).projection.counts.exact), evidence: o.groundedCount(ax) }; }
  const diag = diagnoseAxesV5(rootStats, { S: root.projection.counts.exact, minExactRatio: inputs.treeLimits.min_exact_option_ratio, mirrorSingletonShareMax: inputs.treeLimits.mirror_singleton_share_max, exemptBound: inputs.leafCaps.primary + 1 });
  return { reach: o.verifyReachability(tree.nodes), rootAxis: tree.internalChoices[0] && tree.internalChoices[0].axisId, depth: tree.depth, nodes: tree.nodes.length, leaves: tree.leaves.length, cand: cand.size, atCap: atCap.size, compRate: tree.leaves.length ? Math.round(comp / tree.leaves.length * 100) : 0, rejected: diag.rejected };
}

check("OUD before/after (v4 → v5): reachability holds; report both rules; v5 changes guards not the score", () => {
  const b = measure(RULE_V4), a = measure(RULE_V5);
  console.log(`  · v4: root=${b.rootAxis} depth=${b.depth} nodes=${b.nodes} leaves=${b.leaves} in_pool=${b.cand}/${inputs.skuCount} surface@cap=${b.atCap}/${inputs.skuCount} compromise=${b.compRate}% reachOK=${b.reach.ok}`);
  console.log(`  · v5: root=${a.rootAxis} depth=${a.depth} nodes=${a.nodes} leaves=${a.leaves} in_pool=${a.cand}/${inputs.skuCount} surface@cap=${a.atCap}/${inputs.skuCount} compromise=${a.compRate}% reachOK=${a.reach.ok}`);
  console.log(`  · v5 root mirror/guard-rejected axes (by name): ${a.rejected.length ? a.rejected.map((r) => `${r.ax}[${r.reason}]`).join(", ") : "(none)"}`);
  assert.equal(a.reach.ok, true, "v5 reachability guardrail passes on oud (type fully grounded; origin RELAXABLE)");
  assert.equal(a.cand, 80, "reach unchanged: 80/80 in candidate pool");
});

if (process.exitCode === 1) console.error("\nFAIL — axis-rule v5 did not behave as specified.\n");
else console.log(`\nPASS — all ${passed} axis-rule v5 checks passed (mirror reformed, reachability enforced, partition asserted).\n`);
