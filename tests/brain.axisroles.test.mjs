/**
 * tests/brain.axisroles.test.mjs — BUILD STEP 3 (red-first): axis_role derivation.
 * ---------------------------------------------------------------------------------------------------
 * Order (constitution): semantic PROPOSAL → proposed axis_role → deterministic PREDICATE → counterfactual
 * VALIDATION (validates, never derives). Roles:
 *   • hard            — a mutually-exclusive product category; the wrong value = a categorically wrong
 *                       product (asked oil, got perfume). Violating it is a hard_violation (ق8).
 *   • budget_ceiling  — an ordinal upper bound; exceeding it is a hard_violation, NEVER relaxed (ق13).
 *   • fit             — a WITHIN-category refinement (values co-occur inside one branch: an oil can be
 *                       indian OR borneo, still an oil); a miss is a disclosable soft compromise (ق9).
 * The counterfactual VALIDATES the predicate: swapping a hard value lands in a DISJOINT family set;
 * swapping a fit value stays in the SAME branch. A proposed fit whose values do NOT co-occur within any
 * branch is NOT validated (it would be a disguised category split) — proving validation can reject.
 * Fails RED until authoring/brain/axisRoles.js exists. V3 untouched; axis_role is set HERE, not Step 2.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";
import { discoverAxisContracts } from "../authoring/brain/axisContracts.js";
import { assignAxisRoles } from "../authoring/brain/axisRoles.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "gold-set.json"), "utf8"));
const FORMAT_BRANCH = { perfume: "Perfumes", oil: "Oud Based Oil Creations", raw: "Agarwood", bundle: "Packages" };
const priceByFamily = new Map();
for (const s of gold.sku_offer_truth) if (!priceByFamily.has(s.family)) priceByFamily.set(s.family, s.price);
const familyMatrix = gold.family_decision_truth.map((f) => ({
  family_id: f.family, structured: { product_type: FORMAT_BRANCH[f.format] || "(none)", tags: [] },
  text: { title: f.name || f.family, description: f.origin_basis === "description" ? String(f.origin_evidence || "") : "" },
  prices: [priceByFamily.get(f.family) ?? null],
}));
const skuMatrix = gold.sku_offer_truth.map((s) => ({ sku_id: s.sku, family_id: s.family, price: s.price, currency: s.currency, availability: s.availability, buy_url: s.buy_url, option_values: {} }));

const published = discoverAxisContracts(familyMatrix, skuMatrix).published;
const roled = assignAxisRoles(published, familyMatrix);
const by = new Map(roled.map((a) => [a.axis_key, a]));

// every roled axis carries the full derivation chain (proposal → predicate → validated counterfactual)
for (const a of roled) {
  assert.ok(a.axis_key && a.values && a.applicability, "role assignment preserves the Step-2 contract");
  assert.ok(a.proposed_role && a.axis_role && a.counterfactual, `${a.axis_key} carries proposed_role + axis_role + counterfactual`);
  assert.ok(typeof a.role_validated === "boolean", `${a.axis_key} records whether the counterfactual validated the role`);
}

// type → hard (mutually-exclusive category), validated by disjoint-family counterfactual
assert.strictEqual(by.get("type").axis_role, "hard", "product-type is a hard categorical eligibility axis");
assert.strictEqual(by.get("type").counterfactual.test, "mutual_exclusivity");
assert.ok(by.get("type").role_validated, "type role validated (no family in two categories)");

// price → budget_ceiling (ordinal upper bound, never relaxed)
assert.strictEqual(by.get("price").axis_role, "budget_ceiling", "price is an ordinal budget ceiling");
assert.strictEqual(by.get("price").counterfactual.test, "ordinal_monotonic");
assert.ok(by.get("price").role_validated, "price role validated (bands strictly ordered)");

// origin → fit (within-branch refinement), validated by co-occurrence (indian & borneo both are oils)
assert.strictEqual(by.get("origin").axis_role, "fit", "origin is a soft within-category fit axis, NOT hard (ق7/ق8: unknown must not expel)");
assert.strictEqual(by.get("origin").counterfactual.test, "within_branch_cooccurrence");
assert.ok(by.get("origin").role_validated, "origin fit validated (≥2 origins coexist inside a single branch)");

// the counterfactual VALIDATES, it does not rubber-stamp: a facet axis whose values never co-occur in a
// branch (each value ≡ its own category) must FAIL fit validation.
const splitFacet = { axis_key: "pseudo_origin", source: "description", grade: "C", scope: "facet",
  values: [{ value: "alpha", families: ["a1"], evidence: ["x"] }, { value: "beta", families: ["b1"], evidence: ["y"] }],
  applicability: { kind: "branch-conditional", branches: ["A", "B"], supported_families: ["a1", "b1"], branch_values: { A: ["alpha"], B: ["beta"] } } };
const splitFM = [
  { family_id: "a1", structured: { product_type: "A" }, text: { title: "a", description: "" }, prices: [1] },
  { family_id: "b1", structured: { product_type: "B" }, text: { title: "b", description: "" }, prices: [1] },
];
const splitRoled = assignAxisRoles([splitFacet], splitFM)[0];
assert.strictEqual(splitRoled.role_validated, false, "a facet whose values never co-occur in a branch fails fit validation (validation rejects, not derives)");

console.log("PASS — Step 3 axis_role: " + roled.map((a) => `${a.axis_key}=${a.axis_role}${a.role_validated ? "✓" : "✗"}`).join(" · ") + " ; counterfactual rejects a non-co-occurring facet.");
