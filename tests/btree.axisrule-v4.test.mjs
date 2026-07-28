/**
 * tests/btree.axisrule-v4.test.mjs — AXIS-RULE v4 (consultation round-4). RED-FIRST fix of the v3 COLLAPSE
 * surfaced by the thin-generalization gate: on a uniform partition v3's `N − Σsᵢ²/S` scored 0 for BOTH an
 * ideal even split AND a single-value axis, so the alphabetical tie-break branched a useless one-answer axis.
 *
 * v4: reduction = S − (Σsᵢ² + u₀²)/S, S = node exact-pool |E| (node-constant), u₀ = S − Σsᵢ the explicit
 * unknown residual bucket → ranking == MIN integer `Σsᵢ² + u₀²`. Guards (counts-only): reduction>0,
 * MIRROR (median size 1, or option-density over the exact pool), and the mostly-compromise ratio gate.
 * Tie-break: fewer options → smaller max bucket → higher evidence → canonical id (last resort).
 *
 * This suite asserts BOTH the documented bug (v3 picks the useless axis) AND the fix (v4 does not), so the
 * red→green transition is captured in one place. It also runs the oud before/after (v3 vs v4).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree, RULE_V3, RULE_V4 } from "../authoring/brain2/tree.js";
import { chooseAxisByInfoGainV3, chooseAxisByInfoGainV4, diagnoseAxesV4 } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const pol = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "config", "policy.json"), "utf8"));
const MINR = pol.authoring_tree.min_exact_option_ratio, MDM = pol.authoring_tree.mirror_option_density_max;

// ── C-ROOT: the exact stats that made v3 collapse (budget single-valued) ──────────────────────────────
// exact sizes at C's root: type [2,2,2], budget [6] (single value "mid"), origin [3,3]. S = 6.
const v3statsC = { type: [ {exact:2,eligible:2},{exact:2,eligible:2},{exact:2,eligible:2} ], budget: [ {exact:6,eligible:6} ], origin: [ {exact:3,eligible:3},{exact:3,eligible:3} ] };
const v4statsC = { type: {sizes:[2,2,2], evidence:6}, budget: {sizes:[6], evidence:6}, origin: {sizes:[3,3], evidence:6} };

check("RED (documented bug): v3 branches the SINGLE-VALUE axis 'budget' on the C-root stats", () => {
  assert.equal(chooseAxisByInfoGainV3(v3statsC, { minExactRatio: MINR }), "budget", "v3 collapse: uniform partitions all score 0 → alphabetical → budget");
});
check("GREEN (fix): v4 branches the DISCRIMINATING axis 'type' on the same stats (budget killed as no-split)", () => {
  assert.equal(chooseAxisByInfoGainV4(v4statsC, { S: 6, minExactRatio: MINR, mirrorDensityMax: MDM }), "type", "v4 picks min Σsᵢ²+u₀²: type=12 < origin=18; budget rejected reduction=0");
  const d = diagnoseAxesV4(v4statsC, { S: 6, minExactRatio: MINR, mirrorDensityMax: MDM });
  assert.ok(d.rejected.some((r) => r.ax === "budget" && r.reason === "no-split"), "budget rejected as no-split (single value → reduction 0)");
});

check("reduction>0 guard: a single-value axis (one option = whole pool) is ALWAYS killed", () => {
  const d = diagnoseAxesV4({ solo: { sizes: [10], evidence: 10 } }, { S: 10, minExactRatio: MINR, mirrorDensityMax: MDM });
  assert.equal(d.chosen, null);
  assert.ok(d.rejected.some((r) => r.ax === "solo" && r.reason === "no-split"));
});

check("MIRROR guard: a per-item-identifier axis (14 singleton options) scores the MAX reduction yet is REJECTED", () => {
  const mirror = Array.from({ length: 14 }, () => 1);        // 14 options, each pins exactly one item
  const group = [7, 7];                                       // a real grouping axis over the same pool (S=14)
  // v4 raw reduction of the mirror is the maximum (S−1=13) — proving info-gain alone CANNOT gate it:
  const penalizedMirror = mirror.reduce((a, b) => a + b * b, 0); // 14
  assert.equal(14 - penalizedMirror / 14, 13, "mirror reduction is the absolute max — must be gated by DENSITY, not gain");
  const d = diagnoseAxesV4({ mirror: { sizes: mirror, evidence: 14 }, group: { sizes: group, evidence: 14 } }, { S: 14, minExactRatio: MINR, mirrorDensityMax: MDM });
  assert.equal(d.chosen, "group", "the grouping axis wins; the mirror is out");
  assert.ok(d.rejected.some((r) => r.ax === "mirror" && r.reason.startsWith("mirror")), "mirror rejected BY NAME with a mirror reason: " + JSON.stringify(d.rejected));
});

check("MIRROR density branch fires even when the median size ≠ 1", () => {
  // sizes [2,2,2,2,1,1] S=10: lower-median = 2 (NOT 1), but density k/Σ = 6/10 = 0.6 > 0.5 → mirror:density
  const d = diagnoseAxesV4({ dense: { sizes: [2, 2, 2, 2, 1, 1], evidence: 10 }, grp: { sizes: [5, 5], evidence: 10 } }, { S: 10, minExactRatio: MINR, mirrorDensityMax: MDM });
  assert.ok(d.rejected.some((r) => r.ax === "dense" && r.reason.startsWith("mirror:density")), "dense axis rejected by the density net: " + JSON.stringify(d.rejected));
  assert.equal(d.chosen, "grp");
});

check("UNKNOWN residual u₀: penalized == Σsᵢ² + (S−Σsᵢ)² exactly; the axis that grounds the whole pool wins", () => {
  // At one node S is fixed (=12). u₀ = S − Σsᵢ is the explicit ungrounded-on-axis bucket, and it enters the
  // score as u₀². full [6,6] grounds all 12 (u₀=0); sparse [3,3] grounds only 6 (u₀=6); even [4,4,4] grounds
  // all 12 into 3 even buckets (u₀=0). Min penalized (= max reduction) wins.
  const d = diagnoseAxesV4({ full: { sizes: [6, 6], evidence: 12 }, sparse: { sizes: [3, 3], evidence: 12 }, even: { sizes: [4, 4, 4], evidence: 12 } }, { S: 12, minExactRatio: MINR, mirrorDensityMax: MDM });
  const pen = Object.fromEntries(d.ranked.map((r) => [r.ax, r.penalized]));
  assert.equal(pen.full, 72, "full [6,6] u₀=0 → 36+36+0");
  assert.equal(pen.sparse, 54, "sparse [3,3] u₀=6 → 9+9+6²=54");
  assert.equal(pen.even, 48, "even [4,4,4] u₀=0 → 16+16+16");
  assert.equal(d.chosen, "even", "min penalized (48) wins — even buckets over the whole grounded pool");
});

check("Σsᵢ > S throws (multi-membership unsupported — surfaced, not silently miscomputed)", () => {
  assert.throws(() => diagnoseAxesV4({ x: { sizes: [4, 4], evidence: 8 } }, { S: 6 }), /multi-membership/);
});

check("determinism: v4 is a pure integer ranking (ranking == min Σsᵢ²+u₀²), stable across repeated calls", () => {
  const stats = { a: { sizes: [2, 2, 2], evidence: 6 }, b: { sizes: [3, 3], evidence: 6 } };
  const once = chooseAxisByInfoGainV4(stats, { S: 6, minExactRatio: MINR, mirrorDensityMax: MDM });
  for (let i = 0; i < 5; i++) assert.equal(chooseAxisByInfoGainV4(stats, { S: 6, minExactRatio: MINR, mirrorDensityMax: MDM }), once, "stable");
  assert.equal(once, "a", "a: Σ=12 < b: Σ=18 → a chosen (min penalized)");
});

// ── OUD before/after (v3 vs v4) ───────────────────────────────────────────────────────────────────────
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
  // root mirror-rejected axes, by name (v4 diagnostics on the root's own stats)
  const root = o.evaluateRoot(); const rootStats = {};
  for (const ax of o.axisIds()) { const refs = o.enumerate(root, ax); if (refs.length) rootStats[ax] = { sizes: refs.map((r) => o.probeByRef(root, r.option_ref).projection.counts.exact), evidence: o.groundedCount(ax) }; }
  const diag = diagnoseAxesV4(rootStats, { S: root.projection.counts.exact, minExactRatio: inputs.treeLimits.min_exact_option_ratio, mirrorDensityMax: inputs.treeLimits.mirror_option_density_max });
  return { rootAxis: tree.internalChoices[0] && tree.internalChoices[0].axisId, depth: tree.depth, nodes: tree.nodes.length, leaves: tree.leaves.length, cand: cand.size, atCap: atCap.size, compRate: tree.leaves.length ? Math.round(comp / tree.leaves.length * 100) : 0, rejected: diag.rejected };
}

check("OUD before/after (v3 → v4): report the two rules side by side; v4 is a correction, not a regression", () => {
  const b = measure(RULE_V3), a = measure(RULE_V4);
  console.log(`  · v3: root=${b.rootAxis} depth=${b.depth} nodes=${b.nodes} leaves=${b.leaves} in_pool=${b.cand}/${inputs.skuCount} surface@cap=${b.atCap}/${inputs.skuCount} compromise=${b.compRate}%`);
  console.log(`  · v4: root=${a.rootAxis} depth=${a.depth} nodes=${a.nodes} leaves=${a.leaves} in_pool=${a.cand}/${inputs.skuCount} surface@cap=${a.atCap}/${inputs.skuCount} compromise=${a.compRate}%`);
  console.log(`  · v4 root mirror/guard-rejected axes (by name): ${a.rejected.length ? a.rejected.map((r) => `${r.ax}[${r.reason}]`).join(", ") : "(none)"}`);
  assert.ok(a.rootAxis, "v4 produces a real root axis (tree is not trivial)");
  assert.equal(a.cand, b.cand, "candidate pool (reachability) is unchanged — v4 changes ORDER of questions, not who is reachable");
});

if (process.exitCode === 1) console.error("\nFAIL — axis-rule v4 did not behave as specified.\n");
else console.log(`\nPASS — all ${passed} axis-rule v4 checks passed (collapse fixed, mirror gated, integer-deterministic).\n`);
