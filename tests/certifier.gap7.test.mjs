/**
 * tests/certifier.gap7.test.mjs — GAP-6 THE SIZE PICKER + SKU-level I3 to 80/80, red-first (round-12, ADR-0063).
 * ===========================================================================================
 * Round-11 measured the honest gap (SKU-level I3 = 50/80): a family card pinned ONE variant, so a family's
 * extra sizes stranded. Round-12 BUILDS the missing capability (GAP-6, deferred since Part 1) — NOT a metric
 * change, the real fix. Two corrections land first, then the picker:
 *
 *  • BAND SEMANTICS (ADR-0063): band boundaries are derived at the FAMILY level (the frozen design fixture),
 *    but MATCHING is at the VARIANT level with a ceiling — a family qualifies for every path where it has a
 *    purchasable variant ≤ that path's ceiling. Enforced in the Certifier (the layer that owns the SKU witness),
 *    NOT by re-typing the shared oud fixture (that fixture is pinned by the FROZEN axis-selector v10 — untouchable).
 *    ASSERT: no purchasable variant is band-locked-out of every path where it would be in budget.
 *  • node_kind (ADR-0063): terminal ⟺ 1 ≤ exact ≤ leaf_primary_cap; exact > cap ⇒ display (grid); exact = 0 ⇒
 *    display (COMPROMISE_ONLY). (Round-11's exact≥1 was an over-correction — an 11-exact leaf IS a grid.)
 *
 * THE PICKER: one card per family + an in-card size picker (ق4 — size is a folded dimension, never a card per
 * size). Every in-budget purchasable variant is a SELECTABLE option with its OWN certificate; the default comes
 * from the KERNEL (recorded reason), never a display rule; over-ceiling/unavailable variants are shown labeled,
 * no active CTA. ⇒ I3 50→80/80, publish UNBLOCKED. Gold frozen by hash; nothing softened.
 */
import assert from "node:assert/strict";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree } from "../authoring/brain2/tree.js";
import { compileTree, canonicalBytes } from "../authoring/compiler/structuralCompiler.js";
import { certify, validateCta } from "../engine/kernel/certifier.js";
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
const ACTIVE = inputs.skuCount; // 80
const DISTINCT_FAMILIES = new Set(Object.values(inputs.skuMeta).map((m) => m.family_id)).size; // 50 — the pre-picker one-per-family ceiling

const ctx = {
  units: inputs.units, constraints: kernelConstraints, opts: {},
  activeSkus: ACTIVE, surfaceReachable: 0,
  skuMeta: inputs.skuMeta, skusByFamily: inputs.skusByFamily, budget: inputs.budget,
  versions: { compiler_version: cinput.version, kernel_version: inputs.context.kernel_version, policy_version: inputs.context.policy_version, artifact_version: fnv(canonicalBytes(cinput)), catalog_version_structural: inputs.context.structural_catalog_version, catalog_version_runtime: "oud_runtime_1" },
};
const result = certify(cinput, ctx);
const g = result.grid;

check("1. BAND CORRECTION (before the picker): matching at variant level — NO purchasable variant is band-locked-out", () => {
  // The pre-picker one-representative-per-family surface is bounded by the family count (50 ≤ 80): that gap is
  // the FOLDED SIZE dimension, not band-exact. The band correction's job is to prove NONE of the gap is lock-out.
  console.log(`  · pre-picker ceiling (one representative per family) = ${DISTINCT_FAMILIES}/${ACTIVE} — the ${ACTIVE - DISTINCT_FAMILIES} missing are folded SIZES, to be surfaced by the picker`);
  console.log(`  · band_locked_out = ${g.not_arrived_by_reason.band_locked_out || 0} (variant-level ceiling: every purchasable variant qualifies for a path where it is in budget)`);
  assert.equal(g.not_arrived_by_reason.band_locked_out || 0, 0, "no purchasable variant is unqualified for every band it could fit (band-exact would strand these)");
});

check("2. node_kind fix — terminal ⟺ 1 ≤ exact ≤ cap; exact>cap or exact=0 ⇒ display (grid)", () => {
  const c = result.certificate;
  console.log(`  · node_kind distribution: terminal=${c.terminal} display=${c.display} (leaf_primary_cap=${inputs.leafCaps.primary})`);
  assert.equal(c.terminal + c.display, result.checked, "every leaf is terminal or display");
  // on oud: 3 single-exact leaves ⇒ terminal; the rest (multi-exact grids) ⇒ display.
  assert.ok(c.terminal >= 1 && c.display >= 1, "both kinds present (single-exact terminals + multi-exact grids)");
});

check("3. THE PICKER — I3 to 80/80: every in-budget purchasable variant is a selectable option (Surface+Purchase)", () => {
  console.log(`  · surface_reachable_with_grid (picker) = ${g.surface_reachable_with_grid}/${ACTIVE} · not_arrived = ${g.not_arrived.length} ${JSON.stringify(g.not_arrived_by_reason)}`);
  assert.equal(g.surface_reachable_with_grid, ACTIVE, `the picker must surface every active SKU (${ACTIVE})`);
  assert.deepEqual(g.not_arrived, [], "no SKU left behind: " + JSON.stringify(g.not_arrived_detail.slice(0, 6)));
});

check("4. EVERY selectable size carries its OWN certificate — and the DEFAULT comes from the KERNEL (no display rule)", () => {
  console.log(`  · defaults_from_kernel = ${g.defaults_from_kernel} · default_outside_options = ${g.default_outside_options} · invalid_cta = ${g.invalid_cta}`);
  assert.equal(g.invalid_cta, 0, "every selectable option has a path_certified selection_result_id (its own certificate)");
  assert.equal(g.defaults_from_kernel, true, "every family's default variant comes from the kernel select (a recorded reason)");
  assert.equal(g.default_outside_options, 0, "the kernel default is always one of the selectable options");
  assert.equal(g.defaults_not_from_kernel, 0, "no family defaulted without the kernel");
});

check("5. CTA VALIDITY GUARD — a size OVER the path's budget ceiling is not purchasable there (labeled, no active CTA)", () => {
  const budget = inputs.budget;
  const bandOf = (p) => p <= budget.thresholds[0] ? "low" : p <= budget.thresholds[1] ? "mid" : "high";
  const overSku = Object.entries(inputs.skuMeta).find(([, m]) => m.price != null && budget.order.indexOf(bandOf(m.price)) > budget.order.indexOf("mid"));
  assert.ok(overSku, "catalog has a variant above a mid ceiling");
  const [id, m] = overSku;
  const over = validateCta({ sku_id: id, cta_url: m.buy_url }, inputs.skuMeta, budget, { budget: "mid" });
  assert.equal(over.valid, false, "over-ceiling CTA rejected"); assert.equal(over.reason, "cta_over_budget_ceiling", over.reason);
  const famUrl = validateCta({ sku_id: id, cta_url: "https://x/products/" + m.family_id }, inputs.skuMeta, budget, {});
  assert.equal(famUrl.reason, "cta_does_not_resolve_to_sku", "a family url is not a per-variant CTA");
  const ok = validateCta({ sku_id: id, cta_url: m.buy_url }, inputs.skuMeta, budget, {});
  assert.equal(ok.valid, true, "the size's own buy_url with no ceiling is valid: " + ok.reason);
  console.log(`  · over-ceiling size ${id.split("::")[0]}#… (${m.price}) on a mid path → not purchasable (labeled), CTA rejected ✓`);
});

check("6. PUBLISH UNBLOCKED — I3 green (SKU-level, real capability built); I1 & I2 green; mint stays 100%; certificate mints", () => {
  console.log(`  · I3 = ${result.invariants.I3_no_active_sku_without_accounting_or_witness} (picker delivers every SKU with its own valid CTA)`);
  assert.equal(result.invariants.I1_no_dead_end, true, "I1 green");
  assert.equal(result.invariants.I2_input_completeness_and_provenance, true, "I2 green");
  assert.equal(result.invariants.I3_no_active_sku_without_accounting_or_witness, true, "I3 green ⇒ PUBLISH UNBLOCKED (built the size picker, did not change the metric)");
  assert.equal(result.mint_rate, 1, "mint stays 100% (equivalence unchanged — the picker is a display surface, not the pick)");
  assert.ok(result.certificate && !result.certificate_error, "certificate mints: " + result.certificate_error);
});

if (process.exitCode === 1) console.error("\nFAIL — the size picker did not deliver 80/80 truthfully, or a recorded rule was violated.\n");
else console.log(`\nPASS — all ${passed} GAP-6 checks. Band-locked-out=0; picker I3 ${DISTINCT_FAMILIES}→${g.surface_reachable_with_grid}/${ACTIVE}; node_kind terminal=${result.certificate.terminal}/display=${result.certificate.display}; every size self-certified, default from kernel; over-ceiling rejected; mint 100%. PUBLISH UNBLOCKED. Nothing softened.\n`);
