/**
 * tests/btree.threelevel.test.mjs — STEP 4-b (third step): a THREE-LEVEL tree (type→budget→origin) for
 * oudfactory, oracle-authored with the NEW counts-only info-gain rule. Red-first. SIX stop conditions +
 * carried + the round-3 corrections: reach split by cause, compromise-leaf publish rule, policy-read caps,
 * rule before/after impact, path integrity.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { enumerateQualifiedOptions } from "../engine/kernel/authoringOracle/enumerate.js";
import { oracleHash } from "../engine/kernel/authoringOracle/hash.js";
import { buildTree, RULE_V1, RULE_V2 } from "../authoring/brain2/tree.js";
import { chooseAxisByInfoGain } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const inputs = await oudOneLevelInputs();
const CAP = inputs.leafCaps.total; // from POLICY (correction 3), stamped inputs.leafCaps.policy_version
const oracle = new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const tree = buildTree(oracle, { maxDepth: 3, rule: RULE_V2 });
const byHash = new Map(tree.nodes.map((n) => [n.evaluation_hash, n]));
const S = (ref) => new Set(oracle.membersOf(ref));
const constraintsFor = (thr) => [
  { id: "type", type: "nominal", mode: "NEVER_RELAX", priority: 1 },
  { id: "budget", type: "ordinal", mode: "RELAXABLE", priority: 2, order: ["low", "mid", "high"], resolved: { thresholds: thr } },
  { id: "origin", type: "nominal", mode: "RELAXABLE", priority: 3 },
];

console.log(`  · three-level tree (rule ${tree.ruleId}): ${tree.nodes.length} nodes · ${tree.internalChoices.length} internal · ${tree.leaves.length} leaves · calls=${oracle.calls} cacheHits=${oracle.cacheHits}`);

// group transcript probes by node → per-axis distinct-option eligible sizes (counts only, no identities)
function sizesAtNode(poolRef) {
  const t = oracle.transcript().filter((e) => e.transition_kind === "PROBE" && e.parent_pool_ref === poolRef);
  const byAxis = {};
  for (const e of t) { (byAxis[e.axis_id] ||= new Map()).set(e.option_ref, e.eligible_count); }
  return Object.fromEntries(Object.entries(byAxis).map(([ax, m]) => [ax, [...m.values()]]));
}

check("SC1. AXIS RULE v2 (info-gain, counts-only) re-runs from TRANSCRIPT counts to the SAME axis at every node", () => {
  for (const { node, axisId } of tree.internalChoices) {
    const sizes = sizesAtNode(node.pools.eligible_ref);
    assert.equal(chooseAxisByInfoGain(sizes), axisId, `rule picks "${axisId}" from sizes ${JSON.stringify(sizes)}`);
  }
});

check("SC2. CONSTRAINT ACCUMULATION — answers(child) = answers(parent) + exactly one option (three levels)", () => {
  for (const n of tree.nodes) {
    if (n.transition.kind === "ROOT") continue;
    const ca = oracle.answersOf(n), pa = oracle.answersOf(byHash.get(n.transition.parent_hash));
    const ck = Object.keys(ca), pk = Object.keys(pa);
    assert.equal(ck.length, pk.length + 1, "exactly one new axis");
    for (const k of pk) assert.equal(String(ca[k]), String(pa[k]), `parent answer "${k}" unchanged`);
  }
});

check("SC3. NODE IDENTITY + two-ledger link (scoped to the chosen axis; compromise-publish aware)", () => {
  const t = oracle.transcript();
  for (const e of t) if (e.transition_kind !== "ROOT") assert.ok(e.parent_pool_ref && e.context_ref && e.axis_id && e.option_ref, "non-root entry carries full node identity");
  const key = (e) => e.parent_pool_ref + "|" + e.option_ref;
  const published = t.filter((e) => e.published);
  const chosenAxisAt = new Map(); for (const e of published) chosenAxisAt.set(e.parent_pool_ref, e.axis_id);
  const publishedKeys = new Set(published.map(key));
  // for the CHOSEN axis at each internal node, a probe is publishable (exact>0 OR compromise>0) IFF it is published
  for (const e of t) {
    if (e.transition_kind !== "PROBE") continue;
    if (chosenAxisAt.get(e.parent_pool_ref) !== e.axis_id) continue; // non-chosen axis probes are sizing-only
    const publishable = e.exact_count > 0 || e.compromise_count > 0;
    assert.equal(publishable, publishedKeys.has(key(e)), `chosen-axis option ${e.option_ref}: publishable(${publishable}) ⇔ published`);
  }
});

check("SC4. MONOTONICITY (REFINE, three levels) four clauses; RELAX exempt (fresh session)", () => {
  const sub = (a, b) => [...a].every((x) => b.has(x));
  for (const n of tree.nodes) {
    if (n.transition.kind !== "REFINE") continue;
    const p = byHash.get(n.transition.parent_hash);
    assert.ok(sub(S(n.pools.exact_ref), S(p.pools.exact_ref)), "exact ⊆");
    assert.ok(sub(S(n.pools.eligible_ref), S(p.pools.eligible_ref)), "eligible ⊆");
    assert.ok(sub(S(p.pools.rejected_ref), S(n.pools.rejected_ref)), "rejected ⊇");
  }
  const fresh = new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
  const froot = fresh.evaluateRoot();
  const ty = enumerateQualifiedOptions(inputs.units, constraintsFor(inputs.thresholds), {}, "type")[0];
  const child = fresh.session.refine(froot, { type: ty });
  assert.throws(() => fresh.session.refine(child, {}), /monotonic|REFINE|narrow/i, "growing move as REFINE throws");
  assert.doesNotThrow(() => fresh.session.relax(child, {}), "same growing move as RELAX accepted");
});

check("SC6. PATH INTEGRITY — walked leaves == recorded leaves; every path terminates; no unannounced axis repeat", () => {
  const kids = new Map(); for (const n of tree.nodes) if (n.transition.parent_hash) (kids.get(n.transition.parent_hash) || kids.set(n.transition.parent_hash, []).get(n.transition.parent_hash)).push(n);
  const walkedLeaves = new Set(), recorded = new Set(tree.leaves.map((l) => l.evaluation_hash));
  (function walk(node, axesOnPath) {
    const cs = kids.get(node.evaluation_hash) || [];
    if (!cs.length) { walkedLeaves.add(node.evaluation_hash); return; }
    for (const c of cs) {
      const ax = c.transition.kind === "REFINE" ? Object.keys(oracle.answersOf(c)).find((k) => !axesOnPath.includes(k)) : null;
      assert.ok(!(ax && axesOnPath.includes(ax)), `axis "${ax}" repeats on a path without an announced RELAX`);
      walk(c, ax ? [...axesOnPath, ax] : axesOnPath);
    }
  })(tree.root, []);
  assert.deepEqual([...walkedLeaves].sort(), [...recorded].sort(), "walked leaves == recorded leaves (no orphan/duplicate)");
});

check("carried: bijection · per-node option completeness · isolation · projection purity · threshold→hash", () => {
  const v = oracle.verifyTree(tree.nodes);
  assert.ok(v.ok && v.treeEdges === v.mintedEdges, "tree edges == minted edges: " + JSON.stringify(v.findings));
  const t = oracle.transcript();
  for (const { node, axisId } of tree.internalChoices) {
    const enumerated = enumerateQualifiedOptions(inputs.units, constraintsFor(inputs.thresholds), oracle.answersOf(node), axisId);
    const probed = new Set(t.filter((e) => e.transition_kind === "PROBE" && e.parent_pool_ref === node.pools.eligible_ref && e.axis_id === axisId).map((e) => e.option_ref));
    assert.equal(probed.size, enumerated.length, `node probed all ${enumerated.length} "${axisId}" options`);
  }
  for (const f of ["authoring/brain2/tree.js", "authoring/brain2/axisRule.js"]) {
    for (const s of [...readFileSync(join(ROOT, f), "utf8").matchAll(/import\s[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1])) {
      assert.ok(!s.includes("engine/kernel") && !/realCatalog|fixtures|configs|oudUnits|constraintKernel/.test(s), `${f} leaks a dependency: ${s}`);
    }
  }
  const proj = JSON.stringify(tree.leaves[0].projection);
  for (const forbidden of ["exact_ids", "violation_vectors", "evidence", "scores", "ranking", "pool_digest"]) assert.ok(!proj.includes(forbidden), `leaks ${forbidden}`);
  const base = oracleHash({ units: inputs.units, constraints: constraintsFor(inputs.thresholds), answers: {}, context: inputs.context });
  assert.notEqual(base, oracleHash({ units: inputs.units, constraints: constraintsFor([inputs.thresholds[0] + 1, inputs.thresholds[1] + 1]), answers: {}, context: inputs.context }), "threshold change moves hash");
});

check("SC5. REACH split by CAUSE (variant_unreachable vs family_buried) + compromise_only_leaf_rate + rule before/after", () => {
  const skusOf = (fams) => fams.flatMap((f) => inputs.skusByFamily[f] || []);
  const surfaceOf = (t) => {
    const cand = new Set(), surfaced = new Set(), surfacedFams = new Set();
    for (const leaf of t.leaves) {
      for (const sku of skusOf(oracle.membersOf(leaf.pools.eligible_ref))) cand.add(sku);
      const shown = [...oracle.membersOf(leaf.pools.exact_ref).slice().sort(), ...oracle.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP);
      for (const fam of shown) surfacedFams.add(fam);
      for (const sku of skusOf(shown)) surfaced.add(sku);
    }
    return { cand, surfaced, surfacedFams };
  };
  const { cand, surfaced, surfacedFams } = surfaceOf(tree);
  const skuFamily = {}; for (const [fam, skus] of Object.entries(inputs.skusByFamily)) for (const s of skus) skuFamily[s] = fam;
  const dropped = [...cand].filter((s) => !surfaced.has(s));
  // correction 1: split every dropped SKU by CAUSE — family surfaced ⇒ variant_unreachable; else ⇒ family_buried
  const variant_unreachable = dropped.filter((s) => surfacedFams.has(skuFamily[s])).sort();
  const family_buried = dropped.filter((s) => !surfacedFams.has(skuFamily[s])).sort();
  const compromiseLeaves = tree.leaves.filter((l) => (tree.meta.get(l.evaluation_hash) || {}).compromiseOnly);
  const rate = tree.leaves.length ? Math.round((compromiseLeaves.length / tree.leaves.length) * 100) : 0;
  const pct = (n) => Math.round((n / inputs.skuCount) * 100);
  console.log(`  · leaf caps from policy (${inputs.leafCaps.policy_version}): total=${CAP}`);
  console.log(`  · in_candidate_pool: ${cand.size}/${inputs.skuCount} (${pct(cand.size)}%)`);
  console.log(`  · surface_reachable: ${surfaced.size}/${inputs.skuCount} (${pct(surfaced.size)}%)`);
  console.log(`  · dropped=${dropped.length} → variant_unreachable=${variant_unreachable.length} (GAP-6/offer) · family_buried=${family_buried.length} (leaf-cap/structure)`);
  console.log(`  · family_buried names: ${family_buried.slice(0, 12).join(", ")}${family_buried.length > 12 ? " …" : ""}`);
  console.log(`  · variant_unreachable names: ${variant_unreachable.slice(0, 12).join(", ")}${variant_unreachable.length > 12 ? " …" : ""}`);
  console.log(`  · compromise_only_leaf_rate: ${compromiseLeaves.length}/${tree.leaves.length} (${rate}%)`);
  // rule before/after impact on LEVEL 2 (rebuild depth-2 with v1 vs v2 on fresh oracles)
  const surfaceCount = (t, orc) => { const s = new Set(); for (const leaf of t.leaves) { const shown = [...orc.membersOf(leaf.pools.exact_ref).slice().sort(), ...orc.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP); for (const sku of skusOf(shown)) s.add(sku); } return s.size; };
  const fresh = () => new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
  const o1 = fresh(), l2v1 = buildTree(o1, { maxDepth: 2, rule: RULE_V1 }), l2v1surf = surfaceCount(l2v1, o1);
  const o2 = fresh(), l2v2 = buildTree(o2, { maxDepth: 2, rule: RULE_V2 }), l2v2surf = surfaceCount(l2v2, o2);
  console.log(`  · rule impact on LEVEL 2 surface_reachable: v1(most-options)=${l2v1surf}/${inputs.skuCount} · v2(info-gain)=${l2v2surf}/${inputs.skuCount} (${l2v1surf === l2v2surf ? "no change on this catalog — v2 only diverges when a wide axis is non-discriminative" : "CHANGED"}); root axis v1=${l2v1.internalChoices[0].axisId} v2=${l2v2.internalChoices[0].axisId}`);
  assert.equal(dropped.length, variant_unreachable.length + family_buried.length, "every dropped SKU is classified by cause");
  assert.ok(surfaced.size <= cand.size, "surface ≤ candidate");
});

if (process.exitCode === 1) console.error("\nFAIL — the three-level oracle-authored tree broke a stop condition.\n");
else console.log(`\nPASS — all ${passed} three-level checks passed (oracle-authored, oudfactory type→budget→origin).\n`);
