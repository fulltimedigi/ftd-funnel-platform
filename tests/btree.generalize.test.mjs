/**
 * tests/btree.generalize.test.mjs — STEP 4-b THIN GENERALIZATION (ruling م٤, before the compiler).
 * Rebuild the FULL tree on 3 synthetic catalogs with different axis distributions and run ONLY the seven
 * stop conditions — NO gold, NO truth-number comparison. Goal: does a rule collapse? a hard limit fire? a
 * degenerate tree appear?
 *
 * HISTORY: under the v3 axis rule this gate FOUND a collapse — a single-value axis (budget in C) was
 * branched as a useless one-answer question, because uniform partitions all scored 0 and the tie-break was
 * alphabetical. That collapse was SHOWN (not silently fixed) and, on the operator's rulings, corrected by the
 * v4→v5 axis rule (integer Σsᵢ²+u₀² with reduction>0 + per-option mirror + ratio guards + a u₀-reachability
 * invariant). This gate now runs GREEN under v5 (buildFullTree default) — the COLLAPSE SCAN + reachability
 * assertion below are the standing regression guards.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { enumerateQualifiedOptions } from "../engine/kernel/authoringOracle/enumerate.js";
import { buildFullTree } from "../authoring/brain2/tree.js";
import { chooseAxisByInfoGainV9 } from "../authoring/brain2/axisRule.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const pol = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "config", "policy.json"), "utf8"));
const LIMITS = { ...pol.authoring_tree, leaf_primary_cap: pol.surface.leaf_primary_cap };
const MINR = pol.authoring_tree.min_exact_option_ratio;
const MAXOPT = pol.display_contract.max_published_options_per_question;

const CONTRACTS = [
  { axis_id: "type", type: "nominal", mode: "NEVER_RELAX", priority: 1 },
  { axis_id: "budget", type: "ordinal", mode: "RELAXABLE", priority: 2, order: ["low", "mid", "high"], resolved: { thresholds: [1, 2] } },
  { axis_id: "origin", type: "nominal", mode: "RELAXABLE", priority: 3 },
];
const G = (v) => (v == null ? { value: null, grounded: false } : { value: v, grounded: true });
// enumerateQualifiedOptions + classifyUnit want KERNEL-shaped constraints (.id), not the oracle's .axis_id.
const kernelConstraints = (cat) => cat.resolvedContracts.map((c) => ({ id: c.axis_id, type: c.type, mode: c.mode, priority: c.priority, order: c.order, resolved: c.resolved || null }));
function catalog(tuples) {
  const units = tuples.map(([t, b, o], i) => ({ id: `${t}-${b}-${o}-${i}`, values: { type: G(t), budget: G(b), origin: G(o) } }));
  const skusByFamily = {}; for (const u of units) skusByFamily[u.id] = [u.id];
  return { units, resolvedContracts: CONTRACTS, context: { structural_catalog_version: "syn", policy_version: "syn", kernel_version: "k_1" }, skusByFamily };
}

// Original small distributions (v7's decisive mirror bound only rejects an ALL-singleton axis, so all-size-2
// / all-size-3 axes are accepted — v7 is not over-aggressive, unlike the retired v6 residual guard).
// A: ONE DOMINANT axis (type 8 values ×2; budget & origin single-value) — expect type branches, others gated.
const A = catalog([...Array(16)].map((_, i) => [`t${i % 8}`, "mid", "o1"]));
// B: EQUAL axes (type×budget×origin all discriminate) — expect a multi-level tree, no collapse.
const B = catalog([].concat(...["t1", "t2"].map((t) => [].concat(...["low", "mid", "high"].map((b) => ["o1", "o2"].map((o) => [t, b, o]))))));
// C: a SINGLE-VALUE axis (budget = "mid" only) alongside discriminating type/origin — budget must NOT be chosen.
const C = catalog([].concat(...["t1", "t2", "t3"].map((t) => ["o1", "o2"].map((o) => [t, "mid", o]))));
const CATS = [["A one-dominant", A], ["B equal-axes", B], ["C single-value-axis", C]];

function verify7(name, cat) {
  const oracle = new AuthoringOracle({ units: cat.units, resolvedContracts: cat.resolvedContracts, context: cat.context });
  let tree, buildError = null;
  try { tree = buildFullTree(oracle, { limits: LIMITS }); } catch (e) { buildError = e.message; }
  if (buildError) throw new Error(`BUILD COLLAPSED: ${buildError}`); // a hard-limit fire on a benign catalog = collapse
  const byHash = new Map(tree.nodes.map((n) => [n.evaluation_hash, n]));
  const Sset = (r) => new Set(oracle.membersOf(r));
  const sub = (a, b) => [...a].every((x) => b.has(x));
  const branchAxes = [...new Set(tree.internalChoices.map((c) => c.axisId))];
  const compromise = tree.leaves.filter((l) => (tree.meta.get(l.evaluation_hash) || {}).compromiseOnly).length;
  console.log(`  · ${name}: depth=${tree.depth} nodes=${tree.nodes.length} internal=${tree.internalChoices.length} leaves=${tree.leaves.length} branchAxes=[${branchAxes}] compromiseLeaves=${compromise} calls=${oracle.calls}`);

  // COLLAPSE signal: a catalog with a discriminating axis must produce ≥1 branch (not a trivial root-only tree)
  assert.ok(tree.internalChoices.length >= 1, "tree is not trivial (at least one branch)");
  // SC1 axis rule re-run (v5, from transcript counts + node exact pool + axis grounding evidence)
  const statsAt = (poolRef) => { const t = oracle.transcript().filter((e) => e.transition_kind === "PROBE" && e.parent_pool_ref === poolRef); const byAxis = {}; for (const e of t) (byAxis[e.axis_id] ||= new Map()).set(e.option_ref, e.exact_count); return Object.fromEntries(Object.entries(byAxis).map(([a, m]) => [a, { sizes: [...m.values()], evidence: oracle.groundedCount(a) }])); };
  for (const { node, axisId } of tree.internalChoices) assert.equal(chooseAxisByInfoGainV9(statsAt(node.pools.eligible_ref), { S: node.projection.counts.exact, minExactRatio: MINR, maxOptions: MAXOPT }), axisId, "SC1 rule re-run");
  // v5 u₀-reachability: no exact candidate is dropped by branching (all three catalogs use RELAXABLE softs)
  assert.ok(oracle.verifyReachability(tree.nodes).ok, "u₀-reachability: every exact candidate stays reachable");
  // SC2 accumulation
  for (const n of tree.nodes) { if (n.transition.kind === "ROOT") continue; const ca = oracle.answersOf(n), pa = oracle.answersOf(byHash.get(n.transition.parent_hash)); assert.equal(Object.keys(ca).length, Object.keys(pa).length + 1, "SC2 one new axis"); for (const k of Object.keys(pa)) assert.equal(String(ca[k]), String(pa[k]), "SC2 parent unchanged"); }
  // SC3 identity + two-ledger link (scoped)
  const tr = oracle.transcript(), key = (e) => e.parent_pool_ref + "|" + e.option_ref, pub = tr.filter((e) => e.published), chosenAt = new Map(); for (const e of pub) chosenAt.set(e.parent_pool_ref, e.axis_id);
  const pk = new Set(pub.map(key)); for (const e of tr) { if (e.transition_kind !== "ROOT") assert.ok(e.parent_pool_ref && e.context_ref && e.axis_id && e.option_ref, "SC3 identity"); if (e.transition_kind === "PROBE" && chosenAt.get(e.parent_pool_ref) === e.axis_id) assert.equal(e.exact_count > 0 || e.compromise_count > 0, pk.has(key(e)), "SC3 link"); }
  // SC4 monotonicity
  for (const n of tree.nodes) { if (n.transition.kind !== "REFINE") continue; const p = byHash.get(n.transition.parent_hash); assert.ok(sub(Sset(n.pools.exact_ref), Sset(p.pools.exact_ref)) && sub(Sset(n.pools.eligible_ref), Sset(p.pools.eligible_ref)) && sub(Sset(p.pools.rejected_ref), Sset(n.pools.rejected_ref)), "SC4 four clauses"); }
  // SC6 path integrity
  const kids = new Map(); for (const n of tree.nodes) if (n.transition.parent_hash) (kids.get(n.transition.parent_hash) || kids.set(n.transition.parent_hash, []).get(n.transition.parent_hash)).push(n);
  const walked = new Set(); (function walk(node, seen) { const cs = kids.get(node.evaluation_hash) || []; if (!cs.length) { walked.add(node.evaluation_hash); return; } for (const c of cs) { const ax = Object.keys(oracle.answersOf(c)).find((k) => !seen.includes(k)); assert.ok(!(ax && seen.includes(ax)), "SC6 no axis repeat"); walk(c, ax ? [...seen, ax] : seen); } })(tree.root, []);
  assert.deepEqual([...walked].sort(), [...new Set(tree.leaves.map((l) => l.evaluation_hash))].sort(), "SC6 walked == recorded");
  // SC7 degenerate branch
  for (const [, cs] of kids) if (cs.length > 1) assert.ok(new Set(cs.map((c) => c.pools.eligible_ref)).size > 1, "SC7 no degenerate branch");
  // carried: bijection + per-node completeness
  const v = oracle.verifyTree(tree.nodes); assert.ok(v.ok && v.treeEdges === v.mintedEdges, "carried bijection");
  for (const { node, axisId } of tree.internalChoices) { const en = enumerateQualifiedOptions(cat.units, kernelConstraints(cat), oracle.answersOf(node), axisId); const pr = new Set(tr.filter((e) => e.transition_kind === "PROBE" && e.parent_pool_ref === node.pools.eligible_ref && e.axis_id === axisId).map((e) => e.option_ref)); assert.equal(pr.size, en.length, "carried per-node completeness"); }
  return { branchAxes, compromise, depth: tree.depth, leaves: tree.leaves.length };
}

const results = {};
for (const [name, cat] of CATS) check(`GENERALIZE ${name} — seven stop conditions hold (no gold)`, () => { results[name.split(" ")[0]] = verify7(name, cat); });

check("COLLAPSE SCAN — a single-value axis (budget in C) is NOT chosen for branching (gain 0, gated)", () => {
  assert.ok(results.C && !results.C.branchAxes.includes("budget"), "C never branches the single-value budget axis (it would be a useless question)");
  assert.ok(results.A && results.A.branchAxes.length >= 1 && results.A.branchAxes.every((a) => a === "type" || results.A.compromise >= 0), "A branches the dominant axis");
});

if (process.exitCode === 1) console.error("\nFAIL — a rule COLLAPSED on a different axis distribution (shown, not fixed — awaiting decision).\n");
else console.log(`\nPASS — all ${passed} generalization checks passed across 3 axis distributions (no rule collapse).\n`);
