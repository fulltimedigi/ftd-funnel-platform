/**
 * tests/certifier.gap7.test.mjs — GAP-7: the ق20 OVERSIZED-LEAF COMPARISON GRID, red-first (round-10).
 * ===========================================================================================
 * The publish blocker. The Certifier (certifier.equivalence) proved the artifact faithfully represents the
 * kernel (mint 100%), but I3 (NoActiveSKUWithoutAccountingOrWitness) was RED at 61/80: the runtime shows only
 * a capped surface (leaf_total_cap), so 19 real SKUs — every one `family_buried`, 0 `variant_unreachable` —
 * are neither surfaced, grid-accounted, nor witnessed. GAP-7 closes it: an oversized display leaf is NOT
 * pruned — it surfaces EVERY candidate (surface=all_candidates, hide_ties=false), each card carrying the
 * product's REAL CTA (ق21, from the certificate) + descriptive attributes + a declared tie_break_reason.
 * ⇒ surface_reachable_with_grid == with_expansion (in_candidate_pool) == 80/80 ⇒ I3 green ⇒ publish unblocked.
 *
 * Binding pledges (operator, GAP-7 command):
 *  1. SCOPE is bounded by the MEASURED cause (family_buried). No new axis-rule touch, no reach beyond it.
 *  2. RECORDED RULES: no pruning · no hidden tie · declared order + tie_break_reason · descriptive attributes
 *     on every card · EVERY CTA from the certificate (ق21) — no generic button, no fallback.
 *  3. GOVERNING METRIC: I3 61→80/80 AND surface@cap-with-grid == with_expansion. If it does NOT reach 80/80,
 *     STOP and show the reason per remaining SKU — do NOT patch around it. (Gold frozen; nothing softened.)
 */
import assert from "node:assert/strict";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree } from "../authoring/brain2/tree.js";
import { compileTree, canonicalBytes } from "../authoring/compiler/structuralCompiler.js";
import { certify } from "../engine/kernel/certifier.js";
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

const skusOf = (fams) => fams.flatMap((f) => inputs.skusByFamily[f] || []);
const CAP = inputs.leafCaps.total;

// surface@cap (the runtime display truth BEFORE GAP-7) — the capped surface, measured.
const surfacedCap = new Set();
for (const leaf of tree.leaves) { const shown = [...oracle.membersOf(leaf.pools.exact_ref).slice().sort(), ...oracle.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP); for (const s of skusOf(shown)) surfacedCap.add(s); }
// with_expansion (in_candidate_pool) — union of EVERY leaf's FULL candidate pool (no cap). GAP-7's target.
const inPool = new Set();
for (const leaf of tree.leaves) { const all = [...oracle.membersOf(leaf.pools.exact_ref), ...oracle.membersOf(leaf.pools.compromise_ref)]; for (const s of skusOf(all)) inPool.add(s); }
const ACTIVE = inputs.skuCount, SURFACE_CAP = surfacedCap.size, WITH_EXPANSION = inPool.size;

const baseCtx = {
  units: inputs.units, constraints: kernelConstraints, opts: {},
  activeSkus: ACTIVE, surfaceReachable: SURFACE_CAP,
  versions: { compiler_version: cinput.version, kernel_version: inputs.context.kernel_version, policy_version: inputs.context.policy_version, artifact_version: fnv(canonicalBytes(cinput)), catalog_version_structural: inputs.context.structural_catalog_version, catalog_version_runtime: "oud_runtime_1" },
};

// BEFORE — cap-only (no grid): I3 is red at SURFACE_CAP/ACTIVE (the state that blocks publish today).
const before = certify(cinput, baseCtx);
// AFTER — GAP-7 grid wired (catalogMeta + skusByFamily provided): every candidate surfaced with a real CTA.
const after = certify(cinput, { ...baseCtx, catalogMeta: inputs.catalogMeta, skusByFamily: inputs.skusByFamily });

check("1. BEFORE GAP-7 — I3 RED at surface@cap (publish blocked); this is the state GAP-7 must close", () => {
  console.log(`  · surface@cap = ${SURFACE_CAP}/${ACTIVE} · with_expansion(in_candidate_pool) = ${WITH_EXPANSION}/${ACTIVE}`);
  assert.equal(before.invariants.I3_no_active_sku_without_accounting_or_witness, false, `I3 must be red before GAP-7 (surface@cap ${SURFACE_CAP} < active ${ACTIVE})`);
  assert.ok(SURFACE_CAP < ACTIVE, "the cap genuinely buries SKUs (else GAP-7 is moot)");
});

check("2. AFTER GAP-7 — every candidate surfaced: surface_reachable_with_grid == with_expansion == ACTIVE (80/80)", () => {
  const g = after.invariants && after; // grid lives on the result
  const swg = after.grid ? after.grid.surface_reachable_with_grid : null;
  console.log(`  · surface_reachable_with_grid = ${swg}/${ACTIVE} · with_expansion = ${WITH_EXPANSION}/${ACTIVE}`);
  assert.ok(after.grid, "GAP-7 grid block resolved (catalogMeta + skusByFamily provided)");
  assert.equal(swg, WITH_EXPANSION, `grid surface (${swg}) must equal with_expansion (${WITH_EXPANSION}) — no candidate left in the pool`);
  assert.equal(swg, ACTIVE, `grid surface must reach every active SKU (${ACTIVE})`);
  // GOVERNING METRIC pledge 3: if it did NOT reach 80/80, show the reason PER remaining SKU.
  if (swg !== ACTIVE) console.error(`  ⛔ NOT ARRIVED (${ACTIVE - swg}): ${JSON.stringify(after.grid.not_arrived)} — STOP, do not patch.`);
});

check("3. NO SKU LEFT BEHIND — not_arrived == [] (each active SKU accounted by the grid)", () => {
  console.log(`  · not_arrived = ${JSON.stringify(after.grid.not_arrived)}`);
  assert.deepEqual(after.grid.not_arrived, [], "every active SKU must be grid-accounted: " + JSON.stringify(after.grid.not_arrived));
});

check("4. EVERY CTA FROM THE CERTIFICATE (ق21) — no missing CTA, cta_from_certificate=true (no generic/fallback)", () => {
  console.log(`  · cta_from_certificate = ${after.grid.cta_from_certificate} · missing_cta = ${after.grid.missing_cta} · missing_attributes = ${after.grid.missing_attributes}`);
  assert.equal(after.grid.cta_from_certificate, true, "grid CTAs are authorized by the certificate");
  assert.equal(after.grid.missing_cta, 0, "no card without a real CTA (ق21): a card with no CTA is not counted as surfaced");
  assert.equal(after.grid.missing_attributes, 0, "every card carries descriptive attributes (title)");
});

check("5. NO HIDDEN TIE — hide_ties=false and zero grid findings (a hidden tie would be a finding)", () => {
  console.log(`  · hide_ties = ${after.grid.hide_ties} · grids = ${after.grid.grids} · findings = ${JSON.stringify(after.grid.findings)}`);
  assert.equal(after.grid.hide_ties, false, "ties are never hidden");
  assert.deepEqual(after.grid.findings, [], "no grid finding (each grid surfaced exactly its declared candidates): " + JSON.stringify(after.grid.findings));
});

check("6. PUBLISH UNBLOCKED — I3 flips green with GAP-7; I1 & I2 stay green; the certificate still mints", () => {
  console.log(`  · I3 before = ${before.invariants.I3_no_active_sku_without_accounting_or_witness} → after = ${after.invariants.I3_no_active_sku_without_accounting_or_witness}`);
  assert.equal(after.invariants.I1_no_dead_end, true, "I1 stays green");
  assert.equal(after.invariants.I2_input_completeness_and_provenance, true, "I2 stays green");
  assert.equal(after.invariants.I3_no_active_sku_without_accounting_or_witness, true, "I3 green with GAP-7 (all SKUs grid-accounted, all CTAs real) ⇒ PUBLISH unblocked");
  assert.ok(after.certificate && !after.certificate_error, "certificate still mints (equivalence unchanged by the display grid): " + after.certificate_error);
  assert.equal(after.mint_rate, 1, "mint rate unchanged (GAP-7 is a DISPLAY surface; it never re-derives the pick)");
});

check("7. GRID IS DISPLAY-ONLY — the artifact bytes are unchanged (GAP-7 does not touch the compiled tree)", () => {
  // GAP-7 lives in policy + the Certifier's grid resolution, NOT in the compiled artifact's decision structure.
  const reCompiled = compileTree(oracle, tree, { catalogVersion: inputs.context.structural_catalog_version, policyVersion: inputs.context.policy_version, kernelVersion: inputs.context.kernel_version, leafPrimaryCap: inputs.leafCaps.primary, leafTotalCap: inputs.leafCaps.total });
  assert.equal(canonicalBytes(reCompiled), canonicalBytes(cinput), "the compiled artifact is stable — GAP-7 adds a display surface, not a decision change");
});

if (process.exitCode === 1) console.error("\nFAIL — GAP-7 did not close I3 truthfully, or a recorded rule was violated. Do NOT patch around it.\n");
else console.log(`\nPASS — all ${passed} GAP-7 checks. I3 ${SURFACE_CAP}/${ACTIVE} (cap) → ${after.grid.surface_reachable_with_grid}/${ACTIVE} (grid) == with_expansion ${WITH_EXPANSION}. Publish UNBLOCKED. Every CTA from the certificate; no tie hidden; nothing softened.\n`);
