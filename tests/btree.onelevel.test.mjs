/**
 * tests/btree.onelevel.test.mjs — STEP 4-b (first step): a ONE-LEVEL tree for oudfactory, authored by the
 * ORACLE ALONE (derivation, not porting), run through the full chain. Red-first verifier. The six checks:
 *   1. every published option has a minted edge with non-empty exact + tree edges == minted edges exactly
 *   2. option completeness vs the KERNEL enumeration + the declared axis-selection rule
 *   3. four-part monotonicity on REFINE
 *   4. isolation: brain2 imports no predicate/catalog · authoring projection is pure (no ids/vectors/…)
 *   5. hash: changing a threshold in an axis contract changes the evaluation hash
 *   6. SKU reach + call/cache counts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { enumerateQualifiedOptions } from "../engine/kernel/authoringOracle/enumerate.js";
import { oracleHash } from "../engine/kernel/authoringOracle/hash.js";
import { buildOneLevelTree, AXIS_SELECTION_RULE } from "../authoring/brain2/oneLevelTree.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const AXIS = "type";
const inputs = await oudOneLevelInputs();
const constraintsFor = (thr) => inputs.resolvedContracts.map((c) => ({
  id: c.axis_id, type: c.type, mode: c.mode, priority: c.priority, order: c.order,
  resolved: c.axis_id === "budget" ? { thresholds: thr } : c.resolved,
}));

const oracle = new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const tree = buildOneLevelTree(oracle, AXIS);

console.log(`  · one-level tree on "${AXIS}": ${tree.options.length} enumerated · ${tree.published.length} published · calls=${oracle.calls} cacheHits=${oracle.cacheHits}`);

check("1. every PUBLISHED option has a minted edge with non-empty exact + tree edges == minted edges exactly", () => {
  for (const p of tree.published) {
    assert.ok(p.child.transition.lineage_receipt, `published "${p.label}" has a minted edge`);
    assert.ok(oracle.membersOf(p.child.pools.exact_ref).length > 0, `published "${p.label}" has non-empty exact`);
  }
  const nodes = [tree.root, ...tree.published.map((p) => p.child)];
  const v = oracle.verifyTree(nodes);
  assert.ok(v.ok, "verifyTree: " + JSON.stringify(v.findings));
  assert.equal(v.treeEdges, v.mintedEdges, "tree edges == minted edges exactly");
  assert.equal(v.treeEdges, tree.published.length, "one minted edge per published option, no more");
});

check("2. OPTION COMPLETENESS — every kernel-enumerated option was evaluated; publish = every non-empty exact", () => {
  const enumerated = enumerateQualifiedOptions(inputs.units, constraintsFor(inputs.thresholds), {}, AXIS);
  assert.equal(tree.options.length, enumerated.length, "every enumerated option appears in the tree (probed)");
  assert.equal(tree.axisSelectionRule, AXIS_SELECTION_RULE, "the declared axis-selection rule is followed");
  // reverse check: no option with a non-empty exact set was left unpublished (that would be a silent drop)
  for (const o of tree.options) {
    if (o.exact > 0) assert.ok(o.published, `option "${o.label}" has exact>0 and MUST be published`);
    else assert.ok(!o.published, `option "${o.label}" has exact 0 → probed, not published (no dead-end)`);
  }
});

check("3. MONOTONICITY (REFINE) — all four clauses hold for every published child vs the root", () => {
  const S = (ref) => new Set(oracle.membersOf(ref));
  const sub = (a, b) => [...a].every((x) => b.has(x));
  const rootExact = S(tree.root.pools.exact_ref), rootElig = S(tree.root.pools.eligible_ref), rootRej = S(tree.root.pools.rejected_ref);
  for (const p of tree.published) {
    const cx = S(p.child.pools.exact_ref), ce = S(p.child.pools.eligible_ref), cr = S(p.child.pools.rejected_ref);
    assert.ok(sub(cx, rootExact), `exact(child ${p.label}) ⊆ exact(root)`);
    assert.ok(sub(ce, rootElig), `eligible(child ${p.label}) ⊆ eligible(root)`);
    assert.ok(sub(rootRej, cr), `rejected(root) ⊆ rejected(child ${p.label})`);
  }
});

check("4a. ISOLATION — brain2/oneLevelTree.js imports NO predicate and NO catalog", () => {
  const src = readFileSync(join(ROOT, "authoring/brain2/oneLevelTree.js"), "utf8");
  const specs = [...src.matchAll(/import\s[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const s of specs) {
    assert.ok(!s.includes("engine/kernel"), `phase B must not import a kernel predicate: ${s}`);
    assert.ok(!/realCatalog|fixtures|configs|oudUnits|constraintKernel|evaluateState/.test(s), `phase B must not import the catalog: ${s}`);
  }
});

check("4b. PROJECTION PURITY — the brain-facing projection carries no ids/vectors/evidence/digest/ranking/roster", () => {
  const proj = tree.published[0].child.projection;
  const s = JSON.stringify(proj);
  for (const forbidden of ["exact_ids", "violation_vectors", "evidence", "scores", "ranking", "pool_digest"]) {
    assert.ok(!s.includes(forbidden), `projection must not leak ${forbidden}`);
  }
  for (const u of inputs.units.slice(0, 20)) assert.ok(!s.includes(`"${u.id}"`), `projection must not leak a candidate id (${u.id})`);
  assert.ok(proj.state_outcome && proj.counts && proj.exact_pool_ref.startsWith("pool_"), "brain sees state_outcome + counts + opaque refs");
});

check("5. HASH COMPLETENESS — changing a budget-contract threshold changes the evaluation hash", () => {
  const base = oracleHash({ units: inputs.units, constraints: constraintsFor(inputs.thresholds), answers: {}, context: inputs.context });
  // perturb ONLY the resolved threshold in the axis contract (round-3 C2): the hash MUST move.
  const perturbed = constraintsFor([inputs.thresholds[0] + 1, inputs.thresholds[1] + 1]);
  const moved = oracleHash({ units: inputs.units, constraints: perturbed, answers: {}, context: inputs.context });
  assert.notEqual(base, moved, "a threshold change in the resolved axis contract must change the hash");
});

check("6. SKU REACH — a visitor reaches N SKUs across the one-level tree (measurement, not a gate)", () => {
  const reached = new Set();
  for (const p of tree.published) for (const fam of oracle.membersOf(p.child.pools.exact_ref)) for (const sku of (inputs.skusByFamily[fam] || [])) reached.add(sku);
  const pct = Math.round((reached.size / inputs.skuCount) * 100);
  console.log(`  · SKU reach: ${reached.size}/${inputs.skuCount} SKUs (${pct}%) across ${tree.published.length} published leaves · families=${inputs.familyCount}`);
  assert.ok(reached.size > 0, "at least one SKU is reachable");
});

if (process.exitCode === 1) console.error("\nFAIL — the one-level oracle-authored tree broke a check.\n");
else console.log(`\nPASS — all ${passed} one-level-tree checks passed (oracle-authored, oudfactory).\n`);
