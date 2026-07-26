/**
 * tests/brain.profiles.test.mjs — BUILD STEP 4 (red-first): decision profiles + CONSERVATIVE fold.
 * ---------------------------------------------------------------------------------------------------
 * Family → Decision Profile → SKU (three-level ledger). A profile groups families that the funnel's
 * published axes CANNOT tell apart. Fold rule (conservative): two families fold ⇔ NO published value on
 * ANY axis distinguishes them; when in doubt (unknown vs a value) DO NOT fold. Hard guards:
 *   • never fold across a published price-band boundary (ق4)   • never fold a bundle with a single product.
 * Immediately after folding, the 11-EXACT ceiling is RE-PROVEN (a fold must not merge two families that
 * two different intents need to tell apart). Fails RED until authoring/brain/decisionProfiles.js exists.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";
import { discoverAxisContracts } from "../authoring/brain/axisContracts.js";
import { assignAxisRoles } from "../authoring/brain/axisRoles.js";
import { buildDecisionProfiles } from "../authoring/brain/decisionProfiles.js";

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

const axes = assignAxisRoles(discoverAxisContracts(familyMatrix, skuMatrix).published, familyMatrix);
const { profiles, folds, before, after } = buildDecisionProfiles(axes, familyMatrix, skuMatrix);

assert.ok(Array.isArray(profiles) && Array.isArray(folds), "returns profiles[] + folds[]");
assert.strictEqual(before, familyMatrix.length, "before = family count");
assert.strictEqual(after, profiles.length, "after = profile count");
assert.ok(after <= before, "folding never increases the count");

// every family lands in exactly one profile (no loss, no duplication)
const placed = profiles.flatMap((p) => p.families);
assert.strictEqual(placed.length, before, "every family placed exactly once");
assert.strictEqual(new Set(placed).size, before, "no family in two profiles");

const typeOf = new Map(familyMatrix.map((f) => [f.family_id, f.structured.product_type]));
const bandOf = new Map(); { const pa = axes.find((a) => a.axis_key === "price"); if (pa) for (const v of pa.values) for (const fid of v.families) bandOf.set(fid, v.value); }
const originOf = new Map(); { const oa = axes.find((a) => a.axis_key === "origin"); if (oa) for (const v of oa.values) for (const fid of v.families) originOf.set(fid, v.value); }

for (const p of profiles) {
  // no profile mixes a distinguishing published value: same type, same band, same origin (ق4 + conservative)
  assert.strictEqual(new Set(p.families.map((f) => typeOf.get(f))).size, 1, `profile ${p.profile_id} shares one product type (no cross-category fold)`);
  assert.strictEqual(new Set(p.families.map((f) => bandOf.get(f) || "?")).size, 1, `profile ${p.profile_id} shares one price band (ق4)`);
  assert.strictEqual(new Set(p.families.map((f) => originOf.get(f) || "unknown")).size, 1, `profile ${p.profile_id} shares one origin value (unknown never folds with a value)`);
  assert.ok(p.fold_basis, `profile ${p.profile_id} records fold_basis`);
}

// never fold a bundle (Packages) with a single product
for (const p of profiles) {
  const kinds = new Set(p.families.map((f) => (typeOf.get(f) === "Packages" ? "bundle" : "single")));
  assert.strictEqual(kinds.size, 1, `profile ${p.profile_id} never mixes bundle + single`);
}

// RE-PROVE the ceiling after fold: every EXACT intent still has an accepted family present in some profile
const famInProfile = new Set(placed);
const exact = gold.intents.filter((it) => (Array.isArray(it.expected) ? it.expected : [it.expected]).includes("EXACT"));
for (const it of exact) {
  const accFamilies = (it.accepted_skus || []).map((s) => s.split("::")[0]);
  assert.ok(accFamilies.some((f) => famInProfile.has(f)), `EXACT ${it.id} still has an accepted family after fold`);
  // and that family's profile is the right category (fold did not merge across format)
  for (const f of accFamilies) if (famInProfile.has(f)) assert.strictEqual(typeOf.get(f), FORMAT_BRANCH[it.constraints.format], `EXACT ${it.id} accepted family stays in its own category`);
}

console.log(`PASS — Step 4 profiles: ${before} families → ${after} profiles (${folds.length} folds).`);
for (const f of folds) console.log(`  fold ${f.profile_id} [${f.fold_basis}] ← ${f.families.join(", ")}`);
