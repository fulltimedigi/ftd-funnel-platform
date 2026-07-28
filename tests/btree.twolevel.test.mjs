/**
 * tests/btree.twolevel.test.mjs — STEP 4-b (second step): a TWO-LEVEL tree (type → budget) for oudfactory,
 * authored by the ORACLE ALONE. Red-first verifier. The FIVE mandatory stop conditions + carried checks.
 *   SC1 axis-selection rule re-run (counts-only) picks the SAME axis the brain chose at every node
 *   SC2 constraint accumulation: answers(child) = answers(parent) + exactly one option
 *   SC3 node identity (parent_pool_ref+context_ref+axis_id+option_ref) + the two-ledger link
 *   SC4 four-part REFINE monotonicity across two levels; RELAX is EXEMPT (enforced by transition_kind)
 *   SC5 surface_reachable reported SEPARATELY from in_candidate_pool (+ dropped SKUs named)
 *   carried: tree==minted bijection · per-node option completeness · brain2 isolation · projection purity · threshold→hash
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { enumerateQualifiedOptions } from "../engine/kernel/authoringOracle/enumerate.js";
import { oracleHash } from "../engine/kernel/authoringOracle/hash.js";
import { buildTwoLevelTree } from "../authoring/brain2/twoLevelTree.js";
import { chooseAxis } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALT_CAP = 4; // one primary + three alternates: what a leaf actually SURFACES
let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const inputs = await oudOneLevelInputs();
const oracle = new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const tree = buildTwoLevelTree(oracle, { maxDepth: 2 });
const byHash = new Map(tree.nodes.map((n) => [n.evaluation_hash, n]));
const S = (ref) => new Set(oracle.membersOf(ref));
const constraintsFor = (thr) => [
  { id: "type", type: "nominal", mode: "NEVER_RELAX", priority: 1 },
  { id: "budget", type: "ordinal", mode: "RELAXABLE", priority: 2, order: ["low", "mid", "high"], resolved: { thresholds: thr } },
];

console.log(`  · two-level tree: ${tree.nodes.length} nodes · ${tree.internalChoices.length} internal · ${tree.leaves.length} leaves · calls=${oracle.calls} cacheHits=${oracle.cacheHits}`);

check("SC1. AXIS RULE (counts-only) re-runs to the SAME axis the brain chose at every internal node", () => {
  for (const { node, axisId } of tree.internalChoices) {
    const used = new Set(Object.keys(oracle.answersOf(node)));
    const counts = {};
    for (const ax of oracle.axisIds()) if (!used.has(ax)) { const c = oracle.optionCount(node, ax); if (c > 0) counts[ax] = c; }
    assert.equal(chooseAxis(counts), axisId, `rule picks "${axisId}" from counts ${JSON.stringify(counts)}`);
  }
});

check("SC2. CONSTRAINT ACCUMULATION — answers(child) = answers(parent) + exactly one option (no add/loss/edit)", () => {
  for (const n of tree.nodes) {
    if (n.transition.kind === "ROOT") continue;
    const parent = byHash.get(n.transition.parent_hash);
    const ca = oracle.answersOf(n), pa = oracle.answersOf(parent);
    const ck = Object.keys(ca).sort(), pk = Object.keys(pa).sort();
    assert.equal(ck.length, pk.length + 1, "exactly one new axis added");
    for (const k of pk) assert.equal(String(ca[k]), String(pa[k]), `parent answer "${k}" is unchanged in the child`);
    assert.equal(ck.filter((k) => !pk.includes(k)).length, 1, "exactly one key is new (no silent extra)");
  }
});

check("SC3. NODE IDENTITY + two-ledger link (every minted edge ⇔ a probe with exact≠0)", () => {
  const t = oracle.transcript();
  for (const e of t) {
    assert.ok(e.context_ref, "every entry carries context_ref");
    if (e.transition_kind !== "ROOT") assert.ok(e.parent_pool_ref && e.axis_id && e.option_ref, "non-root entry carries parent_pool_ref+axis_id+option_ref");
  }
  const key = (e) => e.parent_pool_ref + "|" + e.option_ref;
  const probeNonEmpty = new Set(t.filter((e) => e.transition_kind === "PROBE" && e.exact_count > 0).map(key));
  const published = new Set(t.filter((e) => e.published).map(key));
  assert.deepEqual([...published].sort(), [...probeNonEmpty].sort(), "published edges ⇔ probes with exact≠0 (the two ledgers agree)");
});

check("SC4. MONOTONICITY (REFINE, two levels) — four clauses per child; and RELAX is EXEMPT (transition_kind enforced)", () => {
  const sub = (a, b) => [...a].every((x) => b.has(x));
  for (const n of tree.nodes) {
    if (n.transition.kind !== "REFINE") continue;
    const p = byHash.get(n.transition.parent_hash);
    assert.ok(sub(S(n.pools.exact_ref), S(p.pools.exact_ref)), "exact(child) ⊆ exact(parent)");
    assert.ok(sub(S(n.pools.eligible_ref), S(p.pools.eligible_ref)), "eligible(child) ⊆ eligible(parent)");
    assert.ok(sub(S(p.pools.rejected_ref), S(n.pools.rejected_ref)), "rejected(parent) ⊆ rejected(child)");
  }
  // RELAX exempt — on a FRESH session (so it mints nothing into the tree under bijection). Root ⊃ any
  // type-child, so dropping the type promise GROWS eligible: refine() must throw, relax() must accept.
  const fresh = new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
  const froot = fresh.evaluateRoot();
  const someType = enumerateQualifiedOptions(inputs.units, constraintsFor(inputs.thresholds), {}, "type")[0];
  const child = fresh.session.refine(froot, { type: someType });          // narrow
  assert.throws(() => fresh.session.refine(child, {}), /monotonic|REFINE|narrow/i, "a growing move AS A REFINE is rejected");
  assert.doesNotThrow(() => fresh.session.relax(child, {}), "the same growing move AS A RELAX is accepted (monotonicity is REFINE-only)");
});

check("carried: tree edges == minted edges exactly (bijection over BOTH levels)", () => {
  const v = oracle.verifyTree(tree.nodes);
  assert.ok(v.ok, "verifyTree: " + JSON.stringify(v.findings));
  assert.equal(v.treeEdges, v.mintedEdges, "tree edges == minted edges");
});

check("carried: PER-NODE option completeness vs the kernel enumeration (exact match, not global)", () => {
  const t = oracle.transcript();
  for (const { node, axisId } of tree.internalChoices) {
    const enumerated = enumerateQualifiedOptions(inputs.units, constraintsFor(inputs.thresholds), oracle.answersOf(node), axisId);
    const probedHere = new Set(t.filter((e) => e.transition_kind === "PROBE" && e.parent_pool_ref === node.pools.eligible_ref && e.axis_id === axisId).map((e) => e.option_ref));
    assert.equal(probedHere.size, enumerated.length, `node probed all ${enumerated.length} enumerated "${axisId}" options`);
  }
});

check("carried: ISOLATION — brain2 two-level builder + rule import no predicate and no catalog", () => {
  for (const f of ["authoring/brain2/twoLevelTree.js", "authoring/brain2/axisRule.js"]) {
    const specs = [...readFileSync(join(ROOT, f), "utf8").matchAll(/import\s[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specs) {
      assert.ok(!s.includes("engine/kernel"), `${f} must not import a kernel predicate: ${s}`);
      assert.ok(!/realCatalog|fixtures|configs|oudUnits|constraintKernel|evaluateState/.test(s), `${f} must not import the catalog: ${s}`);
    }
  }
});

check("carried: PROJECTION PURITY + HASH — leaf projection leaks nothing; a threshold change moves the hash", () => {
  const proj = tree.leaves[0].projection;
  const s = JSON.stringify(proj);
  for (const forbidden of ["exact_ids", "violation_vectors", "evidence", "scores", "ranking", "pool_digest"]) assert.ok(!s.includes(forbidden), `leaks ${forbidden}`);
  for (const u of inputs.units.slice(0, 20)) assert.ok(!s.includes(`"${u.id}"`), `leaks id ${u.id}`);
  const base = oracleHash({ units: inputs.units, constraints: constraintsFor(inputs.thresholds), answers: {}, context: inputs.context });
  const moved = oracleHash({ units: inputs.units, constraints: constraintsFor([inputs.thresholds[0] + 1, inputs.thresholds[1] + 1]), answers: {}, context: inputs.context });
  assert.notEqual(base, moved, "a budget-contract threshold change must move the hash");
});

check("SC5. REACH — in_candidate_pool vs surface_reachable reported SEPARATELY (+ dropped SKUs named)", () => {
  const skusOf = (fams) => fams.flatMap((f) => inputs.skusByFamily[f] || []);
  const candidatePool = new Set(), surfaced = new Set();
  for (const leaf of tree.leaves) {
    const elig = oracle.membersOf(leaf.pools.eligible_ref);
    for (const sku of skusOf(elig)) candidatePool.add(sku);
    // what a leaf SURFACES: exact first, filled from compromise, capped at ALT_CAP (1 primary + 3 alts)
    const exact = oracle.membersOf(leaf.pools.exact_ref).slice().sort();
    const comp = oracle.membersOf(leaf.pools.compromise_ref).slice().sort();
    const shownFams = [...exact, ...comp].slice(0, ALT_CAP);
    for (const sku of skusOf(shownFams)) surfaced.add(sku);
  }
  const dropped = [...candidatePool].filter((s) => !surfaced.has(s)).sort();
  const pct = (n) => Math.round((n / inputs.skuCount) * 100);
  console.log(`  · in_candidate_pool: ${candidatePool.size}/${inputs.skuCount} (${pct(candidatePool.size)}%)`);
  console.log(`  · surface_reachable: ${surfaced.size}/${inputs.skuCount} (${pct(surfaced.size)}%)  [cap=${ALT_CAP}/leaf, ${tree.leaves.length} leaves]`);
  console.log(`  · dropped from surface (${dropped.length}): ${dropped.slice(0, 20).join(", ")}${dropped.length > 20 ? " …" : ""}`);
  assert.ok(surfaced.size <= candidatePool.size, "surface_reachable ≤ in_candidate_pool by definition");
  assert.ok(candidatePool.size > 0, "at least one candidate");
});

if (process.exitCode === 1) console.error("\nFAIL — the two-level oracle-authored tree broke a stop condition.\n");
else console.log(`\nPASS — all ${passed} two-level checks passed (oracle-authored, oudfactory type→budget).\n`);
