/**
 * tests/brain.ceiling.test.mjs — BLOCKING ceiling proof (operator rule 5): the 11 EXACT stay served.
 * ---------------------------------------------------------------------------------------------------
 * After replacing the coverage-COUNT floor with value-support (Exact-support per value + ≥2 distinct
 * grounded values per branch, bundles excluded), prove the design does NOT lose the exact ceiling:
 * every one of the 11 EXACT gold intents must be SERVABLE by the published axis contracts. If origin
 * ever stops publishing in the oil branch, oil|*|indian (3 EXACT) fall out of served and this goes RED.
 *
 * Truth is the SIGNED gold (ق22): a real familyMatrix is reconstructed from family_decision_truth
 * (description-basis origin evidence only; name_token/inspiration/variant_specific never ground an
 * origin) and run through the ACTUAL discoverAxisContracts. Servability is read off the published
 * branch_values. Unserved is split by cause and category (a) [axis dropped though candidates exist]
 * must be zero — every remaining gap is category (b) [no candidate = structurally inexpressible].
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";
import { discoverAxisContracts } from "../authoring/brain/axisContracts.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "gold-set.json"), "utf8"));

const FORMAT_BRANCH = { perfume: "Perfumes", oil: "Oud Based Oil Creations", raw: "Agarwood", bundle: "Packages" };
const priceByFamily = new Map();
for (const s of gold.sku_offer_truth) if (!priceByFamily.has(s.family)) priceByFamily.set(s.family, s.price);

// reconstruct a real familyMatrix from the SIGNED truth: only description-basis origin becomes evidence
const familyMatrix = gold.family_decision_truth.map((f) => ({
  family_id: f.family,
  structured: { product_type: FORMAT_BRANCH[f.format] || "(none)", tags: [] },
  text: { title: f.name || f.family, description: f.origin_basis === "description" ? String(f.origin_evidence || "") : "" },
  prices: [priceByFamily.get(f.family) ?? null],
}));
const skuMatrix = gold.sku_offer_truth.map((s) => ({ sku_id: s.sku, family_id: s.family, price: s.price, currency: s.currency, availability: s.availability, buy_url: s.buy_url, option_values: {} }));

const out = discoverAxisContracts(familyMatrix, skuMatrix);
const origin = out.published.find((a) => a.axis_key === "origin");
assert.ok(origin, "origin axis must publish (value-support in the oil & raw branches)");
const branchValues = origin.applicability.branch_values || {};

// origin publishes in the oil branch with 'indian' (the 3 EXACT depend on it) and NOT in perfumes (1 value)
assert.ok((branchValues["Oud Based Oil Creations"] || []).includes("indian"), "origin=indian is elicitable in the oil branch");
assert.ok(!("Perfumes" in branchValues), "origin does NOT publish in the perfume branch (only 1 grounded value)");

// servability model: origin=any is always servable; a specific origin needs its value published in the format's branch
const servable = (c) => c.origin === "any" || (branchValues[FORMAT_BRANCH[c.format]] || []).includes(c.origin);

// (rule 5) EVERY EXACT intent is servable — the ceiling is preserved
const exact = gold.intents.filter((it) => (Array.isArray(it.expected) ? it.expected : [it.expected]).includes("EXACT"));
assert.strictEqual(exact.length, 11, "gold has 11 EXACT intents");
const lostExact = exact.filter((it) => !servable(it.constraints));
assert.strictEqual(lostExact.length, 0, "ALL 11 EXACT stay inside served: " + (lostExact.map((i) => i.id).join(", ") || "none lost"));

// unserved split by cause: (a) axis dropped though a real candidate exists → needs G4; (b) no candidate → structural
const hasDescCandidate = (fmt, org) => gold.family_decision_truth.some((f) => f.format === fmt && f.origin === org && f.origin_basis === "description");
const unservedSpecific = gold.intents.filter((it) => it.constraints.origin !== "any" && !servable(it.constraints));
const causeA = unservedSpecific.filter((it) => hasDescCandidate(it.constraints.format, it.constraints.origin)); // candidate exists but not served
const causeB = unservedSpecific.filter((it) => !hasDescCandidate(it.constraints.format, it.constraints.origin)); // no candidate = structural
assert.strictEqual(causeA.length, 0, "category (a) [axis dropped though candidates exist → needs G4] must be zero: " + causeA.map((i) => i.id).join(", "));

console.log(`PASS — ceiling proof: 11/11 EXACT servable (oil|*|indian preserved). origin branch_values = ${JSON.stringify(branchValues)}`);
console.log(`  unserved(origin-specific) = ${unservedSpecific.length}  →  (a) gate-dropped-with-candidates = ${causeA.length} · (b) no-candidate/structural = ${causeB.length} (no G4 needed)`);
