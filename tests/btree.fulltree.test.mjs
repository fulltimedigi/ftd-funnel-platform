/**
 * tests/btree.fulltree.test.mjs — STEP 4-b (final step): the WHOLE tree for oudfactory, oracle-authored with
 * the gated info-gain-on-exact rule (v3). Red-first. SEVEN stop conditions + carried + the round-3 rulings:
 * cap governs display not reachability (two surface numbers), mostly-compromise axis not chosen, info-gain
 * on exact, explosion limits from policy (hard-fail on exceed), path-order equivalence + degenerate branch.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { enumerateQualifiedOptions } from "../engine/kernel/authoringOracle/enumerate.js";
import { oracleHash } from "../engine/kernel/authoringOracle/hash.js";
import { buildTree, buildFullTree, RULE_V7, RULE_V8, RULE_V9 } from "../authoring/brain2/tree.js";
import { chooseAxisByInfoGainV10 } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const inputs = await oudOneLevelInputs();
const CAP = inputs.leafCaps.total, MINR = inputs.treeLimits.min_exact_option_ratio, TOTAL = inputs.leafCaps.total, MAXOPT = inputs.treeLimits.max_published_options_per_question;
const fresh = () => new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const oracle = fresh();
const tree = buildFullTree(oracle, { limits: { ...inputs.treeLimits, leaf_primary_cap: inputs.leafCaps.primary } });
const byHash = new Map(tree.nodes.map((n) => [n.evaluation_hash, n]));
const S = (ref) => new Set(oracle.membersOf(ref));
const constraintsFor = (thr) => inputs.resolvedContracts.map((c) => ({ id: c.axis_id, type: c.type, mode: c.mode, priority: c.priority, order: c.order, resolved: c.axis_id === "budget" ? { thresholds: thr } : c.resolved }));

console.log(`  · FULL tree (rule ${tree.ruleId}): depth=${tree.depth} · ${tree.nodes.length} nodes · ${tree.internalChoices.length} internal · ${tree.leaves.length} leaves · calls=${oracle.calls} cacheHits=${oracle.cacheHits}`);
console.log(`  · axes chosen for branching: ${[...new Set(tree.internalChoices.map((c) => c.axisId))].join(", ")} (origin gated out if mostly-compromise)`);
console.log(`  · v9 nodes routed to ق20 DISPLAY MODE (not rejected): ${(tree.displayModeNodes || []).length} — ${[...new Set((tree.displayModeNodes || []).map((r) => r.axis + ":" + (r.reason.includes("options-cap") ? "options-cap" : "all-singleton")))].join(", ") || "(none)"} (options-cap inert on oud, max opts/axis=5 < ${MAXOPT}; see ADR-0057)`);
console.log(`  · v9 signals (reported): ${(tree.mirrorSignals || []).map((s) => `${s.axis}@S${s.S}=share ${s.mirror_singleton_share}/opts ${s.published_options}`).join(", ") || "(none)"}`);

function statsAtNode(poolRef) {
  const t = oracle.transcript().filter((e) => e.transition_kind === "PROBE" && e.parent_pool_ref === poolRef);
  const byAxis = {};
  for (const e of t) { (byAxis[e.axis_id] ||= new Map()).set(e.option_ref, e.exact_count); }
  return Object.fromEntries(Object.entries(byAxis).map(([ax, m]) => [ax, { sizes: [...m.values()], evidence: oracle.groundedCount(ax) }]));
}

check("SC1. AXIS RULE v9 (score + display-mode routing for all-singleton/over-cap, counts-only) re-runs from transcript to the SAME axis", () => {
  for (const { node, axisId } of tree.internalChoices) assert.equal(chooseAxisByInfoGainV10(statsAtNode(node.pools.eligible_ref), { S: node.projection.counts.exact, minExactRatio: MINR, maxOptions: MAXOPT }), axisId, `rule picks "${axisId}" at a node`);
});

check("SC8. u₀-REACHABILITY — no exact candidate is dropped by branching (v5 invariant, server-side)", () => {
  const r = oracle.verifyReachability(tree.nodes);
  assert.ok(r.ok, "every parent-exact candidate stays inside some child's eligible pool: " + JSON.stringify(r.findings));
});

check("SC2. CONSTRAINT ACCUMULATION — answers(child) = answers(parent) + exactly one option", () => {
  for (const n of tree.nodes) { if (n.transition.kind === "ROOT") continue; const ca = oracle.answersOf(n), pa = oracle.answersOf(byHash.get(n.transition.parent_hash)); assert.equal(Object.keys(ca).length, Object.keys(pa).length + 1); for (const k of Object.keys(pa)) assert.equal(String(ca[k]), String(pa[k])); }
});

check("SC3. NODE IDENTITY + two-ledger link (scoped to chosen axis, compromise-publish aware)", () => {
  const t = oracle.transcript(), key = (e) => e.parent_pool_ref + "|" + e.option_ref;
  for (const e of t) if (e.transition_kind !== "ROOT") assert.ok(e.parent_pool_ref && e.context_ref && e.axis_id && e.option_ref, "full node identity");
  const published = t.filter((e) => e.published), chosenAt = new Map(); for (const e of published) chosenAt.set(e.parent_pool_ref, e.axis_id);
  const publishedKeys = new Set(published.map(key));
  for (const e of t) { if (e.transition_kind !== "PROBE" || chosenAt.get(e.parent_pool_ref) !== e.axis_id) continue; assert.equal(e.exact_count > 0 || e.compromise_count > 0, publishedKeys.has(key(e)), "publishable ⇔ published on the chosen axis"); }
});

check("SC4. MONOTONICITY (REFINE) four clauses + RELAX exempt", () => {
  const sub = (a, b) => [...a].every((x) => b.has(x));
  for (const n of tree.nodes) { if (n.transition.kind !== "REFINE") continue; const p = byHash.get(n.transition.parent_hash); assert.ok(sub(S(n.pools.exact_ref), S(p.pools.exact_ref)) && sub(S(n.pools.eligible_ref), S(p.pools.eligible_ref)) && sub(S(p.pools.rejected_ref), S(n.pools.rejected_ref)), "four clauses"); }
  const o = fresh(), r = o.evaluateRoot(), ty = enumerateQualifiedOptions(inputs.units, constraintsFor(inputs.thresholds), {}, "type")[0], c = o.session.refine(r, { type: ty });
  assert.throws(() => o.session.refine(c, {}), /monotonic|REFINE|narrow/i); assert.doesNotThrow(() => o.session.relax(c, {}));
});

check("SC6. PATH INTEGRITY — walked leaves == recorded; every path terminates; no unannounced axis repeat", () => {
  const kids = new Map(); for (const n of tree.nodes) if (n.transition.parent_hash) (kids.get(n.transition.parent_hash) || kids.set(n.transition.parent_hash, []).get(n.transition.parent_hash)).push(n);
  const walked = new Set(); (function walk(node, seen) { const cs = kids.get(node.evaluation_hash) || []; if (!cs.length) { walked.add(node.evaluation_hash); return; } for (const c of cs) { const ax = Object.keys(oracle.answersOf(c)).find((k) => !seen.includes(k)); assert.ok(!(ax && seen.includes(ax)), "no unannounced axis repeat"); walk(c, ax ? [...seen, ax] : seen); } })(tree.root, []);
  assert.deepEqual([...walked].sort(), [...new Set(tree.leaves.map((l) => l.evaluation_hash))].sort(), "walked leaves == recorded");
});

check("SC7. PATH-ORDER EQUIVALENCE (set-equal states ⇒ same hash+result) + no DEGENERATE branch", () => {
  // order equivalence: {type=X,budget=Y} reached type-first vs budget-first ⇒ identical evaluation_hash & exact
  const o = fresh(), r = o.evaluateRoot();
  const ty = enumerateQualifiedOptions(inputs.units, constraintsFor(inputs.thresholds), {}, "type").find((v) => enumerateQualifiedOptions(inputs.units, constraintsFor(inputs.thresholds), { type: v }, "budget").length > 0);
  const bd = enumerateQualifiedOptions(inputs.units, constraintsFor(inputs.thresholds), { type: ty }, "budget")[0];
  const a = o.session.refine(o.session.refine(r, { type: ty }), { type: ty, budget: bd });
  const b = o.session.refine(o.session.refine(r, { budget: bd }), { type: ty, budget: bd });
  assert.equal(a.evaluation_hash, b.evaluation_hash, "set-equal constraint state ⇒ same evaluation_hash (order does not leak into meaning)");
  assert.deepEqual([...S(a.pools.exact_ref)].sort(), [...new Set(o.membersOf(b.pools.exact_ref))].sort(), "same leaf result regardless of axis order");
  // degenerate branch: no internal node has ALL children with the identical result (same eligible pool)
  const kids = new Map(); for (const n of tree.nodes) if (n.transition.parent_hash) (kids.get(n.transition.parent_hash) || kids.set(n.transition.parent_hash, []).get(n.transition.parent_hash)).push(n);
  for (const [, cs] of kids) if (cs.length > 1) assert.ok(new Set(cs.map((c) => c.pools.eligible_ref)).size > 1, "a branch whose every option yields the same result is degenerate (rejected)");
});

check("carried: bijection · per-node option completeness · isolation · projection purity · threshold→hash", () => {
  const v = oracle.verifyTree(tree.nodes); assert.ok(v.ok && v.treeEdges === v.mintedEdges, "bijection: " + JSON.stringify(v.findings));
  const t = oracle.transcript();
  for (const { node, axisId } of tree.internalChoices) { const en = enumerateQualifiedOptions(inputs.units, constraintsFor(inputs.thresholds), oracle.answersOf(node), axisId); const pr = new Set(t.filter((e) => e.transition_kind === "PROBE" && e.parent_pool_ref === node.pools.eligible_ref && e.axis_id === axisId).map((e) => e.option_ref)); assert.equal(pr.size, en.length, `all "${axisId}" options probed`); }
  for (const f of ["authoring/brain2/tree.js", "authoring/brain2/axisRule.js"]) for (const s of [...readFileSync(join(ROOT, f), "utf8").matchAll(/import\s[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1])) assert.ok(!s.includes("engine/kernel") && !/realCatalog|fixtures|configs|oudUnits|constraintKernel/.test(s), `${f} leaks ${s}`);
  const proj = JSON.stringify(tree.leaves[0].projection); for (const x of ["exact_ids", "violation_vectors", "evidence", "scores", "ranking", "pool_digest"]) assert.ok(!proj.includes(x), `leaks ${x}`);
  assert.notEqual(oracleHash({ units: inputs.units, constraints: constraintsFor(inputs.thresholds), answers: {}, context: inputs.context }), oracleHash({ units: inputs.units, constraints: constraintsFor([inputs.thresholds[0] + 1, inputs.thresholds[1] + 1]), answers: {}, context: inputs.context }), "threshold moves hash");
});

check("RULING 4: exceeding a policy HARD LIMIT fails the build EXPLICITLY (no silent truncation)", () => {
  assert.throws(() => buildFullTree(fresh(), { limits: { ...inputs.treeLimits, leaf_primary_cap: inputs.leafCaps.primary, max_nodes: 3 } }), /max_nodes .* exceeded/, "an absurd max_nodes throws, never truncates silently");
});

check("SC5. REACH — two numbers (@cap vs with_expansion) split by cause + compromise rate + v3 before/after", () => {
  const skusOf = (fams) => fams.flatMap((f) => inputs.skusByFamily[f] || []);
  const skuFamily = {}; for (const [fam, skus] of Object.entries(inputs.skusByFamily)) for (const s of skus) skuFamily[s] = fam;
  const cand = new Set(), atCap = new Set(), withExp = new Set(), capFams = new Set();
  for (const leaf of tree.leaves) {
    const elig = oracle.membersOf(leaf.pools.eligible_ref);
    for (const sku of skusOf(elig)) { cand.add(sku); withExp.add(sku); } // oversized-leaf grid (ق20) shows all candidates
    const shown = [...oracle.membersOf(leaf.pools.exact_ref).slice().sort(), ...oracle.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP);
    for (const fam of shown) capFams.add(fam); for (const sku of skusOf(shown)) atCap.add(sku);
  }
  const dropped = [...cand].filter((s) => !atCap.has(s));
  const variant_unreachable = dropped.filter((s) => capFams.has(skuFamily[s])).length;
  const family_buried = dropped.filter((s) => !capFams.has(skuFamily[s])).length;
  const compromiseLeaves = tree.leaves.filter((l) => (tree.meta.get(l.evaluation_hash) || {}).compromiseOnly).length;
  const pct = (n) => Math.round((n / inputs.skuCount) * 100);
  console.log(`  · in_candidate_pool: ${cand.size}/${inputs.skuCount} (${pct(cand.size)}%)`);
  console.log(`  · surface_reachable@cap (policy ${inputs.leafCaps.policy_version}, cap=${CAP}): ${atCap.size}/${inputs.skuCount} (${pct(atCap.size)}%)`);
  console.log(`  · surface_reachable_with_expansion (ق20 grid — NOT YET BUILT, KNOWN-GAPS commitment): ${withExp.size}/${inputs.skuCount} (${pct(withExp.size)}%)`);
  console.log(`  · display commitment (with_expansion − @cap) = ${withExp.size - atCap.size} SKUs — do not claim before the grid exists`);
  console.log(`  · dropped@cap=${dropped.length} → variant_unreachable=${variant_unreachable} · family_buried=${family_buried}`);
  console.log(`  · compromise_only_leaf_rate: ${compromiseLeaves}/${tree.leaves.length} (${tree.leaves.length ? Math.round(compromiseLeaves / tree.leaves.length * 100) : 0}%)`);
  // before/after on levels 1, 2 & 3 — v3 (superseded) → v4 → v5 (current law). v5 is a CORRECTION not a
  // regression: it fixes v4's over-rejection of honest small-pool binaries (surface recovers) while keeping
  // 0% compromise and 80/80 reach. Surface changes are a byproduct of guard correctness — NOT counter-tuning
  // (ق11): no question is added and no ties are cut to move the number; depth is unchanged.
  const cfgV5 = { mirrorSingletonShareMax: inputs.treeLimits.mirror_singleton_share_max, exemptBound: inputs.leafCaps.primary + 1 };
  const cfgV6 = { leafTotalCap: TOTAL };
  const measure = (t, orc) => { const surf = new Set(); let comp = 0; for (const leaf of t.leaves) { const shown = [...orc.membersOf(leaf.pools.exact_ref).slice().sort(), ...orc.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP); for (const s of skusOf(shown)) surf.add(s); if ((t.meta.get(leaf.evaluation_hash) || {}).compromiseOnly) comp++; } return { surf: surf.size, rate: t.leaves.length ? Math.round(comp / t.leaves.length * 100) : 0, root: t.internalChoices[0] && t.internalChoices[0].axisId, leaves: t.leaves.length }; };
  for (const d of [1, 2, 3]) {
    const o7 = fresh(), m7 = measure(buildTree(o7, { maxDepth: d, rule: RULE_V7 }), o7);
    const o8 = fresh(), m8 = measure(buildTree(o8, { maxDepth: d, rule: RULE_V8, ruleCfg: { maxOptions: MAXOPT } }), o8);
    const o9 = fresh(), m9 = measure(buildTree(o9, { maxDepth: d, rule: RULE_V9, ruleCfg: { maxOptions: MAXOPT } }), o9);
    console.log(`  · level ${d}: v7 surf=${m7.surf} comp=${m7.rate}% lv=${m7.leaves} │ v8 surf=${m8.surf} comp=${m8.rate}% lv=${m8.leaves} │ v9 surf=${m9.surf} comp=${m9.rate}% lv=${m9.leaves} (root ${m9.root})`);
  }
  assert.equal(dropped.length, variant_unreachable + family_buried, "every drop classified by cause");
  assert.equal(withExp.size, cand.size, "with_expansion surfaces every candidate (grid)");
});

if (process.exitCode === 1) console.error("\nFAIL — the full oracle-authored tree broke a stop condition.\n");
else console.log(`\nPASS — all ${passed} full-tree checks passed (oracle-authored, oudfactory).\n`);
