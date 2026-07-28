/**
 * tests/certifier.gap7.test.mjs — GAP-7 re-measured at SKU LEVEL, red-first (round-11, ADR-0062).
 * ===========================================================================================
 * The family-level "unblock" (round-10) was WRONG: it counted a family as accounted and silently credited ALL
 * its variants — so `variant_unreachable = 0` was true BY CONSTRUCTION, never by measurement. It hid the size
 * gap since Part 1 (it is why deferring the variant/size picker looked safe — it was UNMEASURED, not safe).
 *
 * The honest measure is per active SKU (operator, round-11):
 *  • Surface Witness — the sku appears as a SELECTABLE option in a reachable leaf (its family showing is NOT
 *    enough); the runtime pins ONE variant per family card, so a family's extra sizes have no selection path.
 *  • Purchase Witness (available) — a CTA that resolves to THAT sku (its own buy_url + price), present in the
 *    shipped catalog snapshot, and satisfying the path's HARD budget ceiling. A family url is not a per-variant
 *    CTA; a variant priced over the answered band's ceiling is a broken purchase promise (not surfaced).
 *
 * Binding pledges: show the number AS IT FALLS OUT (expected < 80/80); DO NOT fix — the size picker is not
 * built here. I3 is RED until measured at SKU level AND reaching 80/80 with both witnesses ⇒ publish RE-BLOCKED.
 * Gold frozen by hash, never re-signed; nothing softened.
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
const ctx = {
  units: inputs.units, constraints: kernelConstraints, opts: {},
  activeSkus: ACTIVE, surfaceReachable: 0,
  skuMeta: inputs.skuMeta, skusByFamily: inputs.skusByFamily, budget: inputs.budget,
  versions: { compiler_version: cinput.version, kernel_version: inputs.context.kernel_version, policy_version: inputs.context.policy_version, artifact_version: fnv(canonicalBytes(cinput)), catalog_version_structural: inputs.context.structural_catalog_version, catalog_version_runtime: "oud_runtime_1" },
};
const result = certify(cinput, ctx);
const g = result.grid;

check("1. SKU-LEVEL I3 is RED and BELOW 80/80 (shown as it falls out — NOT fixed)", () => {
  console.log(`  · surface_reachable_with_grid (SKU-level) = ${g.surface_reachable_with_grid}/${ACTIVE}`);
  console.log(`  · not_arrived = ${g.not_arrived.length} · by reason = ${JSON.stringify(g.not_arrived_by_reason)}`);
  assert.equal(result.invariants.I3_no_active_sku_without_accounting_or_witness, false, "I3 MUST be red at the SKU level (the family metric hid the gap)");
  assert.ok(g.surface_reachable_with_grid < ACTIVE, `SKU-level surface (${g.surface_reachable_with_grid}) must be below active (${ACTIVE}) — the buried variants are real`);
});

check("2. WHY each SKU didn't arrive — every not-arrived sku carries a reason (family_buried | variant_unreachable | variant_over_ceiling)", () => {
  const REASONS = new Set(["family_buried", "variant_unreachable", "variant_over_ceiling"]);
  for (const d of g.not_arrived_detail) assert.ok(REASONS.has(d.reason), `sku ${d.sku_id} has a classified reason (got ${d.reason})`);
  // the dominant cause is the unbuilt size picker: a family surfaces, but its extra variants are not selectable.
  const sample = g.not_arrived_detail.slice(0, 8).map((d) => `${d.sku_id.split("::")[0]}#…:${d.reason}`);
  console.log(`  · sample not-arrived: ${JSON.stringify(sample)}`);
  console.log(`  · variant_unreachable = the family shows but the variant/size picker (unbuilt) makes extra sizes unselectable`);
});

check("3. THE FAMILY-METRIC BLINDNESS, recorded: variant_unreachable was 0 BY CONSTRUCTION, not by measurement", () => {
  // Under the old family metric EVERY variant of a surfaced family was credited ⇒ variant_unreachable≡0 always.
  // Now, measured per sku, the buried variants surface as a real, non-zero count.
  const stranded = (g.not_arrived_by_reason.variant_unreachable || 0) + (g.not_arrived_by_reason.variant_over_ceiling || 0);
  assert.ok(stranded > 0, "the SKU-level measure exposes real stranded variants the family metric hid (>0)");
  console.log(`  · stranded variants now VISIBLE = ${stranded} (were silently 0 under the family metric)`);
});

check("4. CTA VALIDITY GUARD — a CTA to a variant OVER the path's budget ceiling FAILS (existence ≠ validity)", () => {
  const budget = inputs.budget;
  // find a real over-ceiling variant: a sku whose band exceeds a mid-budget path.
  const overSku = Object.entries(inputs.skuMeta).find(([, m]) => m.price != null && budget.order.indexOf(m.price <= budget.thresholds[0] ? "low" : m.price <= budget.thresholds[1] ? "mid" : "high") > budget.order.indexOf("mid"));
  assert.ok(overSku, "the catalog has a variant above a mid ceiling to test with");
  const [id, m] = overSku;
  const answersMid = { budget: "mid" };
  const good = validateCta({ sku_id: id, cta_url: m.buy_url }, inputs.skuMeta, budget, answersMid);
  assert.equal(good.valid, false, "a CTA to an over-ceiling variant must be REJECTED");
  assert.equal(good.reason, "cta_over_budget_ceiling", "with the over-ceiling reason: " + good.reason);
  // and: a family url (not a specific sku's buy_url) is rejected as not resolving to a sku.
  const famUrl = validateCta({ sku_id: id, cta_url: "https://www.oudfactory.com/products/" + m.family_id }, inputs.skuMeta, budget, {});
  assert.equal(famUrl.valid, false, "a family url is not a per-variant CTA");
  assert.equal(famUrl.reason, "cta_does_not_resolve_to_sku", "rejected as not resolving to the sku: " + famUrl.reason);
  // sanity: the sku's OWN buy_url with no budget ceiling is valid.
  const ok = validateCta({ sku_id: id, cta_url: m.buy_url }, inputs.skuMeta, budget, {});
  assert.equal(ok.valid, true, "the sku's own buy_url with no ceiling is valid: " + ok.reason);
  console.log(`  · over-ceiling variant ${id.split("::")[0]}#… (${m.price}) on a mid path → REJECTED (cta_over_budget_ceiling) ✓`);
});

check("5. PUBLISH RE-BLOCKED — the previous unblock was a family metric; reverted. I1 & I2 stay green; I3 red", () => {
  assert.equal(result.invariants.I1_no_dead_end, true, "I1 stays green");
  assert.equal(result.invariants.I2_input_completeness_and_provenance, true, "I2 stays green");
  assert.equal(result.invariants.I3_no_active_sku_without_accounting_or_witness, false, "I3 red at the SKU level ⇒ PUBLISH BLOCKED (reverted the family-metric unblock)");
  console.log(`  · PUBLISH BLOCKED: ${ACTIVE - g.surface_reachable_with_grid} SKUs lack a Surface/Purchase witness. The unblock awaits the variant/size picker (unbuilt) — not a metric change.`);
});

check("6. THE CERTIFICATE still mints — equivalence (tree↔runtime) is UNCHANGED; the gap is DISPLAY reach, not the pick", () => {
  assert.equal(result.mint_rate, 1, "mint stays 100% — the artifact still faithfully represents the kernel");
  assert.ok(result.certificate && !result.certificate_error, "certificate issued (equivalence holds): " + result.certificate_error);
});

if (process.exitCode === 1) console.error("\nFAIL — the SKU-level I3 measure or the CTA guard did not behave as required.\n");
else console.log(`\nPASS — all ${passed} GAP-7(SKU) checks. I3 SKU-level ${g.surface_reachable_with_grid}/${ACTIVE} (RED) — reverted the family-metric unblock; ${ACTIVE - g.surface_reachable_with_grid} variants stranded (${JSON.stringify(g.not_arrived_by_reason)}); CTA guard rejects over-ceiling + family-url; certificate still mints. PUBLISH BLOCKED. Nothing softened.\n`);
