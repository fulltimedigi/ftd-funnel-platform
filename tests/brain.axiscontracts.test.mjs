/**
 * tests/brain.axiscontracts.test.mjs — BUILD STEP 2 (red-first): axis contracts + gates.
 * Discovery must (ق1/ق5/ق6): mine candidate axes from the two matrices with SPAN-level evidence,
 * then gate them — junk tokens ('de','based','packages') REJECTED at the source (not cleaned later),
 * evidence-backed axes PUBLISHED, and a type-heterogeneous value set (origin ⊕ product-line)
 * REJECTED even with good entropy. Crafted fixture mirrors oudfactory's facet3 junk pattern.
 * Fails RED until authoring/brain/axisContracts.js exists. V3 untouched.
 */
import assert from "node:assert";
import { discoverAxisContracts } from "../authoring/brain/axisContracts.js";

// crafted familyMatrix (mirrors oudfactory: real structured type + description origin spans + junk title tokens)
const familyMatrix = [
  { family_id: "indian-oud-oil", structured: { product_type: "Oud Based Oil Creations", tags: [] }, text: { title: "Indian Oud Oil", description: "100% Pure Indian agarwood oil, long lasting." }, prices: [416.5] },
  { family_id: "wild-borneo-oil", structured: { product_type: "Oud Based Oil Creations", tags: [] }, text: { title: "Wild Borneo Oud Oil", description: "100% pure wild Borneo agarwood oil from the region of Sabah." }, prices: [1200] },
  { family_id: "patchouli", structured: { product_type: "Perfumes", tags: [] }, text: { title: "Patchouli Picante de Parfum", description: "A bright patchouli based composition." }, prices: [686] },
  { family_id: "encens", structured: { product_type: "Perfumes", tags: [] }, text: { title: "Encens Noir Parfum", description: "Smoky incense based accord." }, prices: [700] },
  { family_id: "kalimantan-wood", structured: { product_type: "Agarwood", tags: [] }, text: { title: "Kalimantan Agarwood", description: "Kalimantan Wood pieces." }, prices: [315] },
];
const skuMatrix = familyMatrix.map((f, i) => ({ sku_id: f.family_id + "::0", family_id: f.family_id, price: f.prices[0], availability: "available", buy_url: "u", option_values: {} }));

const out = discoverAxisContracts(familyMatrix, skuMatrix);
assert.ok(Array.isArray(out.published) && Array.isArray(out.rejected), "returns published[] + rejected[]");

const allValues = out.published.flatMap((a) => a.values.map((v) => String(v.value).toLowerCase()));
// 1) junk tokens never become a published option value (rejected at source — ق5/ق6)
for (const junk of ["de", "based", "packages", "parfum"]) assert.ok(!allValues.includes(junk), `junk token '${junk}' must not be a published value`);

// 2) every published axis: >=2 values, each with >=1 evidence span, and axis_role NOT set (that is Step 3)
for (const a of out.published) {
  assert.ok(a.axis_key && a.values.length >= 2, `published axis ${a.axis_key} has >=2 values`);
  for (const v of a.values) assert.ok(Array.isArray(v.evidence) && v.evidence.length >= 1, `value ${a.axis_key}=${v.value} carries evidence span(s)`);
  assert.ok(!("axis_role" in a), "axis_role is assigned in Step 3, not here");
}

// 3) a structured product-type axis is published with basis 'structured' (evidence = the field)
const typeAxis = out.published.find((a) => a.values.some((v) => /perfume|agarwood|oil/i.test(v.value)));
assert.ok(typeAxis, "a product-type/form axis is discovered from the structured field");

// 4) origin axis, if published, is evidence-backed from DESCRIPTION material spans (Indian, Borneo)
//    and is type-HOMOGENEOUS (no product-line/junk mixed in)
const originAxis = out.published.find((a) => a.axis_key === "origin" || a.values.some((v) => /indian|borneo|kalimantan/i.test(v.value)));
if (originAxis) {
  for (const v of originAxis.values) {
    assert.ok(v.evidence.some((e) => /agarwood|wood|oud|pure|region/i.test(e)), `origin value ${v.value} has material-adjacent span evidence`);
    assert.ok(!/parfum|de|based|packages|katana/i.test(v.value), `origin axis stays homogeneous (no ${v.value})`);
  }
}

// 5) rejected axes carry a reason
for (const r of out.rejected) assert.ok(r.axis_key && r.reason, "rejected axis names a reason");

console.log(`PASS — Step 2 axis contracts: ${out.published.length} published, ${out.rejected.length} rejected; junk tokens rejected at source.`);
console.log("  published:", out.published.map((a) => a.axis_key + "[" + a.values.map((v) => v.value).join(",") + "]").join(" · "));
console.log("  rejected:", out.rejected.map((r) => r.axis_key + "(" + r.reason + ")").join(" · "));
