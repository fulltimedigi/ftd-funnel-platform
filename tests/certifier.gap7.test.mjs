/**
 * tests/certifier.gap7.test.mjs — GAP-6 THE SIZE PICKER with REAL per-size certificates, red-first
 * (round-12, ADR-0063/0064). ===========================================================================
 * Round-11 measured the honest gap (SKU-level I3 = 50/80). Round-12 BUILT the picker (GAP-6). Round-12b closes
 * the hole my own question exposed: a per-size `selection_result_id` was a DERIVED HASH — a buy button with no
 * proof (ق21). Now every selectable size carries a `SelectionResult` MINTED BY THE KERNEL for that path + that
 * sku (no hash, no authored id); the Certifier rejects any option without a real certificate.
 *
 *  • Band matching at the VARIANT level with a ceiling (ADR-0063); band_locked_out = 0.
 *  • node_kind (ADR-0063): terminal ⟺ 1 ≤ exact ≤ DISPLAY primary cap (constitution: ≤3, from policy —
 *    DECOUPLED from the tree's semantic-stop, which the frozen v10 fixture needs). On oud: terminal=6, display=5.
 *  • THE PICKER: one card per family + in-card size picker (ق4); every in-budget purchasable size is a SELECTABLE
 *    option with a REAL kernel certificate; the default comes from the KERNEL; over-ceiling/unavailable sizes are
 *    labeled, no active CTA; a multi-size card shows a PRICE RANGE, never a single price.
 *
 * I3 → 80/80 with REAL certificates ⇒ publish UNBLOCKED. Gold frozen by hash; nothing softened.
 */
import assert from "node:assert/strict";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree } from "../authoring/brain2/tree.js";
import { compileTree, canonicalBytes } from "../authoring/compiler/structuralCompiler.js";
import { certify, validateCta, isMintedCertificate } from "../engine/kernel/certifier.js";
import { select } from "../engine/kernel/constraintKernel.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return (h >>> 0).toString(16); }

const inputs = await oudOneLevelInputs();
const limits = { ...inputs.treeLimits, leaf_primary_cap: inputs.leafCaps.primary };
const kernelConstraints = inputs.resolvedContracts.map((c) => ({ id: c.axis_id, type: c.type, mode: c.mode, priority: c.priority, order: c.order, resolved: c.resolved || null }));
const oracle = new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const tree = buildFullTree(oracle, { limits });
const cinput = compileTree(oracle, tree, { catalogVersion: inputs.context.structural_catalog_version, policyVersion: inputs.context.policy_version, kernelVersion: inputs.context.kernel_version, leafPrimaryCap: inputs.leafCaps.primary, displayPrimaryCap: inputs.leafCaps.display_primary, leafTotalCap: inputs.leafCaps.total });
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
  console.log(`  · pre-picker ceiling (one representative per family) = ${DISTINCT_FAMILIES}/${ACTIVE} — the ${ACTIVE - DISTINCT_FAMILIES} missing are folded SIZES, to be surfaced by the picker`);
  console.log(`  · band_locked_out = ${g.not_arrived_by_reason.band_locked_out || 0}`);
  assert.equal(g.not_arrived_by_reason.band_locked_out || 0, 0, "no purchasable variant is unqualified for every band it could fit");
});

check("2. node_kind — cap from POLICY (constitution ≤3), decoupled from the tree semantic-stop; terminal ⟺ 1≤exact≤cap", () => {
  const c = result.certificate;
  console.log(`  · display primary cap (policy) = ${inputs.leafCaps.display_primary} · tree semantic-stop (policy) = ${inputs.leafCaps.primary}`);
  console.log(`  · node_kind distribution: terminal=${c.terminal} display=${c.display} (leaves with 1..${inputs.leafCaps.display_primary} exact ⇒ terminal; more ⇒ grid)`);
  assert.equal(inputs.leafCaps.display_primary, 3, "the constitutional display primary cap is 3, sourced from policy (not a code literal)");
  assert.equal(c.terminal + c.display, result.checked, "every leaf is terminal or display");
  assert.ok(c.terminal >= 1 && c.display >= 1, "both kinds present");
});

check("3. THE PICKER — I3 to 80/80: every in-budget purchasable size is a selectable option (Surface+Purchase)", () => {
  console.log(`  · surface_reachable_with_grid (picker) = ${g.surface_reachable_with_grid}/${ACTIVE} · not_arrived = ${g.not_arrived.length} ${JSON.stringify(g.not_arrived_by_reason)}`);
  assert.equal(g.surface_reachable_with_grid, ACTIVE, `the picker must surface every active SKU (${ACTIVE})`);
  assert.deepEqual(g.not_arrived, [], "no SKU left behind: " + JSON.stringify(g.not_arrived_detail.slice(0, 6)));
});

check("4. REAL CERTIFICATES — every surfaced size counts ONLY via a kernel-minted SelectionResult (no derived hash)", () => {
  console.log(`  · uncertified = ${g.uncertified} · certificates_minted_by_kernel = ${g.certificates_minted_by_kernel} · defaults_from_kernel = ${g.defaults_from_kernel} · default_outside_options = ${g.default_outside_options}`);
  assert.equal(g.uncertified, 0, "no surfaced size lacks a real minted certificate");
  assert.equal(g.certificates_minted_by_kernel, true, "every size's certificate is minted by the kernel");
  assert.equal(g.defaults_from_kernel, true, "every family default comes from the kernel select");
  assert.equal(g.default_outside_options, 0, "the kernel default is one of the selectable options");
});

check("4b. HASH-REPLACEMENT REJECTED — a derived hash is NOT a certificate; only a real minted SelectionResult passes", () => {
  // a REAL minted result for a concrete sku+path
  const sku = Object.keys(inputs.skuMeta)[0]; const m = inputs.skuMeta[sku];
  const famUnit = inputs.units.find((u) => String(u.id) === m.family_id);
  const vunit = { id: sku, values: { ...(famUnit ? Object.fromEntries(Object.entries(famUnit.values)) : {}), budget: { value: "low", grounded: true } } };
  const real = select([vunit], kernelConstraints, {}, {});
  assert.equal(isMintedCertificate(real, sku), real.product_id === sku, "a real kernel SelectionResult for this sku passes the guard");
  assert.equal(isMintedCertificate(fnv(`leaf|${sku}`), sku), false, "a derived fnv HASH is rejected (not a certificate)");
  assert.equal(isMintedCertificate({ product_id: sku, match_state: "EXACT", policy_hash: "x" }, sku), false, "a hand-built plain object (not frozen, not kernel-minted) is rejected");
  assert.equal(isMintedCertificate(real, "some-other-sku"), false, "a real certificate for a DIFFERENT sku does not certify this one");
  console.log(`  · real minted SelectionResult ✓ passes · derived hash ✗ rejected · plain object ✗ rejected · wrong-sku ✗ rejected`);
});

check("4c. PRICE-DISPLAY HONESTY — a multi-size family card shows a price RANGE, not a single price", () => {
  assert.equal(g.missing_range, 0, "no multi-size card shows a single price masquerading as THE product price");
  console.log(`  · missing_range = ${g.missing_range} (every multi-size card carries price_from..price_to)`);
});

check("5. CTA VALIDITY GUARD — a size OVER the path's budget ceiling is not purchasable there (labeled, no active CTA)", () => {
  const budget = inputs.budget;
  const bandOf = (p) => p <= budget.thresholds[0] ? "low" : p <= budget.thresholds[1] ? "mid" : "high";
  const overSku = Object.entries(inputs.skuMeta).find(([, m]) => m.price != null && budget.order.indexOf(bandOf(m.price)) > budget.order.indexOf("mid"));
  assert.ok(overSku, "catalog has a variant above a mid ceiling");
  const [id, m] = overSku;
  const over = validateCta({ sku_id: id, cta_url: m.buy_url }, inputs.skuMeta, budget, { budget: "mid" });
  assert.equal(over.reason, "cta_over_budget_ceiling", "over-ceiling CTA rejected: " + over.reason);
  const famUrl = validateCta({ sku_id: id, cta_url: "https://x/products/" + m.family_id }, inputs.skuMeta, budget, {});
  assert.equal(famUrl.reason, "cta_does_not_resolve_to_sku", "a family url is not a per-variant CTA");
  console.log(`  · over-ceiling size ${id.split("::")[0]}#… (${m.price}) on a mid path → not purchasable (labeled), CTA rejected ✓`);
});

check("6. PUBLISH UNBLOCKED — I3 green (real capability + real certs); I1 & I2 green; mint stays 100%; certificate mints", () => {
  console.log(`  · I3 = ${result.invariants.I3_no_active_sku_without_accounting_or_witness}`);
  assert.equal(result.invariants.I1_no_dead_end, true, "I1 green");
  assert.equal(result.invariants.I2_input_completeness_and_provenance, true, "I2 green");
  assert.equal(result.invariants.I3_no_active_sku_without_accounting_or_witness, true, "I3 green ⇒ PUBLISH UNBLOCKED (built the picker + real certs)");
  assert.equal(result.mint_rate, 1, "mint stays 100% (equivalence unchanged)");
  assert.ok(result.certificate && !result.certificate_error, "certificate mints: " + result.certificate_error);
});

if (process.exitCode === 1) console.error("\nFAIL — the size picker did not deliver 80/80 with REAL certificates, or a recorded rule was violated.\n");
else console.log(`\nPASS — all ${passed} GAP-6 checks. band_locked_out=0; picker I3 ${DISTINCT_FAMILIES}→${g.surface_reachable_with_grid}/${ACTIVE} on REAL kernel certs (uncertified=0); node_kind terminal=${result.certificate.terminal}/display=${result.certificate.display} (cap=3); default from kernel; price range shown; over-ceiling rejected; hash-as-cert rejected; mint 100%. PUBLISH UNBLOCKED. Nothing softened.\n`);
