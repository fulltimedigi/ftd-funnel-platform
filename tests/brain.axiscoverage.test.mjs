/**
 * tests/brain.axiscoverage.test.mjs — GATE FIX (red-first): coverage denominator = APPLICABILITY SCOPE.
 * ---------------------------------------------------------------------------------------------------
 * Bug (3rd instance of "wrong denominator"): the grounding-coverage gate divided evidence families by
 * the WHOLE catalog. A conditional axis (origin) that applies only inside one branch was judged against
 * families it never applies to (perfumes, wood) — like counting engines across a supermarket. Fix is
 * SYSTEMIC, not origin-specific (constitution: "نطاق انطباق معرَّف" / defined applicability scope):
 * coverage is computed PER BRANCH (structured product_type), the axis publishes RESTRICTED to branches
 * that clear the floor, and it carries applicability = { branches, supported_families }.
 *
 * Fails RED on the old global-denominator gate: the axis below has global coverage 2/10 = 0.20 (< 0.30)
 * so the old gate REJECTS it, but its evidence is 2/2 = 1.00 inside the "Agarwood" branch, so the fixed
 * gate must PUBLISH it scoped to that branch. V3 untouched.
 */
import assert from "node:assert";
import { discoverAxisContracts } from "../authoring/brain/axisContracts.js";

// 8 perfumes (no material origin) + 2 agarwood (both carry a real material-adjacent origin span).
// Global origin coverage = 2/10 = 0.20 (< 0.30, old gate REJECTS). Per-branch Agarwood = 2/2 = 1.00.
const familyMatrix = [
  ...Array.from({ length: 8 }, (_, i) => ({
    family_id: "perfume-" + i, structured: { product_type: "Perfumes", tags: [] },
    text: { title: "Parfum " + i, description: "A bright floral composition, number " + i + "." }, prices: [600 + i],
  })),
  { family_id: "kalimantan-wood", structured: { product_type: "Agarwood", tags: [] },
    text: { title: "Kalimantan Agarwood", description: "100% pure Kalimantan agarwood wood, aged." }, prices: [315] },
  { family_id: "malaysian-wood", structured: { product_type: "Agarwood", tags: [] },
    text: { title: "Malaysian Agarwood", description: "Pure Malaysian agarwood wood from the region." }, prices: [441] },
];
const skuMatrix = familyMatrix.map((f) => ({ sku_id: f.family_id + "::0", family_id: f.family_id, price: f.prices[0], availability: "available", buy_url: "u", option_values: {} }));

const out = discoverAxisContracts(familyMatrix, skuMatrix);

// 1) origin publishes DESPITE 0.20 global coverage — because within its applicability branch it is 1.00
const origin = out.published.find((a) => a.axis_key === "origin");
assert.ok(origin, "origin must publish on per-branch (applicability-scoped) coverage, not be rejected by the whole-catalog denominator");

// 2) every published axis carries an explicit applicability scope (branches + supported_families)
for (const a of out.published) {
  assert.ok(a.applicability && Array.isArray(a.applicability.branches) && Array.isArray(a.applicability.supported_families),
    `published axis ${a.axis_key} declares applicability { branches, supported_families }`);
  assert.ok(a.applicability.supported_families.length >= 1, `${a.axis_key} applicability scope is non-empty`);
}

// 3) origin's applicability is CONFINED to the branch where it is grounded (Agarwood), not the whole catalog
assert.deepStrictEqual(origin.applicability.branches, ["Agarwood"], "origin applies only to the branch it is grounded in");
assert.ok(origin.applicability.supported_families.every((f) => /wood/.test(f)), "origin scope contains only Agarwood families (no perfumes)");
assert.ok(!origin.applicability.supported_families.some((f) => /perfume-/.test(f)), "perfume families are OUTSIDE origin's applicability (correct denominator)");

// 4) a structured catalog-wide axis (type) still applies across the whole catalog
const typeAxis = out.published.find((a) => a.axis_key === "type");
assert.ok(typeAxis && typeAxis.applicability.supported_families.length === familyMatrix.length, "catalog-wide axis (type) has full-catalog applicability");

console.log(`PASS — gate fix: coverage denominator = applicability scope. origin published scoped to [${origin.applicability.branches.join(",")}] (global cov 0.20, branch cov 1.00).`);
