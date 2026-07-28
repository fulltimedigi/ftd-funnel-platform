/**
 * tests/certifier.equivalence.test.mjs — the CERTIFIER (phase 2), red-first (round-10, ADR-0058/0059).
 * The moment of truth: the FIRST number that says whether everything built is actually runnable.
 *
 * Binding pledges (operator, round-10):
 *  1. The Certifier does NOT trust the compiler's receipts — it RE-DERIVES. For each leaf: walk its
 *     accumulated answers, call the kernel afresh, and compare to what the artifact claims (state, counts, and
 *     the fully-determined pick ∈ the re-derived pool). Any difference = the artifact ≠ the kernel ⇒ fail.
 *     This IS tree↔runtime equivalence — the core of the phase.
 *  2. The mint rate is shown AS-IS. If < 100% ⇒ diagnose; NEVER soften a contract/constant/assertion to raise
 *     it. Same as the frozen-gold pledge.
 *  3. EXPECTED & ACCEPTED: the third invariant fails. NoActiveSKUWithoutAccountingOrWitness is RED (61/80) —
 *     correct, not a defect; it blocks PUBLISH, not measurement. Shown red, not fixed.
 *  4. The certificate constructor lives inside the kernel alone; it is minted ONLY when checked=certified=
 *     valid_terminals=expected>0 ∧ unresolved=0. Input-completeness + provenance enforced.
 */
import assert from "node:assert/strict";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree } from "../authoring/brain2/tree.js";
import { compileTree, canonicalBytes } from "../authoring/compiler/structuralCompiler.js";
import { certify, makeCertificate } from "../engine/kernel/certifier.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return (h >>> 0).toString(16); }

const inputs = await oudOneLevelInputs();
const limits = { ...inputs.treeLimits, leaf_primary_cap: inputs.leafCaps.primary };
const kernelConstraints = inputs.resolvedContracts.map((c) => ({ id: c.axis_id, type: c.type, mode: c.mode, priority: c.priority, order: c.order, resolved: c.resolved || null }));
const oracle = new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const tree = buildFullTree(oracle, { limits });
const cinput = compileTree(oracle, tree, { catalogVersion: inputs.context.structural_catalog_version, policyVersion: inputs.context.policy_version, kernelVersion: inputs.context.kernel_version, leafPrimaryCap: inputs.leafCaps.primary, leafTotalCap: inputs.leafCaps.total });

// surface@cap (the runtime display truth today) + active SKUs — measured, then passed in as CONTEXT (the
// Certifier does not compute display; it consumes the honest runtime numbers).
const CAP = inputs.leafCaps.total; const skusOf = (fams) => fams.flatMap((f) => inputs.skusByFamily[f] || []);
const surfaced = new Set();
for (const leaf of tree.leaves) { const shown = [...oracle.membersOf(leaf.pools.exact_ref).slice().sort(), ...oracle.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP); for (const s of skusOf(shown)) surfaced.add(s); }
const ACTIVE = inputs.skuCount, SURFACE = surfaced.size;

const ctx = {
  units: inputs.units, constraints: kernelConstraints, opts: {},
  activeSkus: ACTIVE, surfaceReachable: SURFACE,
  versions: { compiler_version: cinput.version, kernel_version: inputs.context.kernel_version, policy_version: inputs.context.policy_version, artifact_version: fnv(canonicalBytes(cinput)), catalog_version_structural: inputs.context.structural_catalog_version, catalog_version_runtime: "oud_runtime_1" },
};
const result = certify(cinput, ctx);

check("1. TREE↔RUNTIME EQUIVALENCE — the Certifier RE-DERIVES every leaf from the kernel and it matches the artifact", () => {
  const mismatched = result.perLeaf.filter((l) => !l.ok);
  console.log(`  · re-derivation: ${result.certified}/${result.checked} leaves match the kernel · mismatched=${mismatched.length}`);
  assert.equal(mismatched.length, 0, "every leaf's re-derivation must match: " + JSON.stringify(mismatched.slice(0, 3)));
});

check("2. THE REAL MINT RATE (shown as-is, no softening)", () => {
  console.log(`  · REAL MINT RATE = ${result.certified}/${result.expected_reachable_paths} = ${(result.mint_rate * 100).toFixed(1)}%`);
  assert.equal(result.mint_rate, 1, `mint rate is ${result.mint_rate} — if <1 it is diagnosed, never softened`);
});

check("5. INPUT-COMPLETENESS + PROVENANCE — every leaf's SelectionResult is fully kernel-determined; every field traces to a receipt", () => {
  assert.ok(result.invariants.I2_input_completeness_and_provenance, "I2 must hold: " + JSON.stringify(result.perLeaf.filter((l) => !l.ok)));
  for (const l of result.perLeaf) if (l.state !== "HONEST_NO_MATCH") assert.ok(l.pick != null, `leaf ${l.node_id} has a fully-determined pick`);
});

check("3. THE THREE INVARIANTS — I1 & I2 green; I3 (NoActiveSKUWithoutAccountingOrWitness) RED, as EXPECTED (blocks publish, not measurement)", () => {
  const inv = result.invariants;
  console.log(`  · I1 no-dead-end = ${inv.I1_no_dead_end} · I2 input-completeness+provenance = ${inv.I2_input_completeness_and_provenance} · I3 accounting = ${inv.I3_no_active_sku_without_accounting_or_witness} (surface ${SURFACE}/${ACTIVE})`);
  assert.equal(inv.I1_no_dead_end, true, "I1 green");
  assert.equal(inv.I2_input_completeness_and_provenance, true, "I2 green");
  assert.equal(inv.I3_no_active_sku_without_accounting_or_witness, false, `I3 MUST be red at ${SURFACE}/${ACTIVE} (GAP-7 not built) — this is correct, it blocks PUBLISH; showing it red, not fixing it`);
  console.log(`  · ⇒ CERTIFIED (artifact faithfully represents the kernel) but NOT PUBLISHABLE (I3 red, GAP-7 publish blocker). ${ACTIVE - SURFACE} SKUs unaccounted today.`);
});

check("4. THE CERTIFICATE — minted (equivalence holds) with the agreed counts + versions; constructor is kernel-side", () => {
  assert.ok(result.certificate && !result.certificate_error, "certificate issued (checked=certified=valid_terminals=expected, unresolved=0): " + result.certificate_error);
  const c = result.certificate;
  const stateDist = result.perLeaf.reduce((m, l) => ((m[l.state] = (m[l.state] || 0) + 1), m), {});
  console.log(`  · certificate: expected=${c.expected_reachable_paths} checked=${c.checked} certified=${c.certified} terminal=${c.terminal} display=${c.display} unresolved=${c.unresolved}`);
  console.log(`  · leaf STATE distribution (decisiveness — independent of the node_kind label): ${JSON.stringify(stateDist)} — NOTE: terminal/display node_kind uses resolved-pool≤cap; a leaf with 1 EXACT pick + alternates is EXACT_AVAILABLE (decisive) yet labeled 'display'. Finding logged (quality) in ADR-0059/step16.`);
  console.log(`  · versions: policy=${c.versions.policy_version} compiler=${c.versions.compiler_version} kernel=${c.versions.kernel_version} artifact=${c.versions.artifact_version} catalog[struct=${c.versions.catalog_version_structural}, runtime=${c.versions.catalog_version_runtime}]`);
  assert.equal(c.checked, c.expected_reachable_paths); assert.equal(c.certified, c.expected_reachable_paths); assert.equal(c.unresolved, 0);
  for (const v of ["policy_version", "compiler_version", "kernel_version", "artifact_version", "catalog_version_structural", "catalog_version_runtime"]) assert.ok(c.versions[v] != null, `certificate carries ${v}`);
});

check("PLEDGE 1 (no trust): tampering a leaf receipt is CAUGHT by re-derivation ⇒ certificate REFUSED", () => {
  const tampered = JSON.parse(canonicalBytes(cinput));
  const q = (function find(n) { if (n.node_kind !== "question") return n.receipt ? n : null; for (const c of n.children) { const r = find(c.child); if (r) return r; } return null; })(tampered.root);
  q.receipt.counts.exact = q.receipt.counts.exact + 7; // a lie the kernel will contradict
  const r2 = certify(tampered, ctx);
  assert.ok(r2.unresolved > 0, "the tampered leaf must fail re-derivation");
  assert.equal(r2.certificate, null, "a certificate must NOT be minted when equivalence fails");
  assert.ok(r2.certificate_error, "the kernel-side constructor refuses: " + r2.certificate_error);
});

check("PLEDGE 4 (kernel-side constructor refuses an incomplete tally)", () => {
  assert.throws(() => makeCertificate({ expected_reachable_paths: 5, checked: 5, certified: 4, valid_terminals: 4, unresolved: 1, terminal: 4, display: 0 }, ctx.versions), /certificate refused/);
});

if (process.exitCode === 1) console.error("\nFAIL — the Certifier found the artifact does not represent the kernel, or a pledge was violated.\n");
else console.log(`\nPASS — all ${passed} certifier checks. Mint ${(result.mint_rate * 100).toFixed(0)}% (equivalence holds); I3 red (${SURFACE}/${ACTIVE}, GAP-7 publish blocker); certificate issued.\n`);
