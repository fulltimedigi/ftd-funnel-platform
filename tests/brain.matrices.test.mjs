/**
 * tests/brain.matrices.test.mjs — BUILD STEP 1 (red-first): the two-matrix Ledger adapter.
 * The Part-2 brain must keep TWO separate matrices (decision arbitration rule "مصفوفتان لا واحدة"):
 *   • familyMatrix  — Family × candidate decision observations (structured + text, for discovery)
 *   • skuMatrix     — SKU × offer attributes (price/availability/buy_url/options)
 * Merging them re-hides Part-1's per-variant accounting. This fails RED until authoring/brain/
 * ledgerMatrices.js exists. No V3 code touched.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";
import { skusFromShopifyJson } from "../authoring/ingest/shopify.js";
import { buildSkuLedger } from "../authoring/ingest/skuLedger.js";
import { loadIngestPolicy } from "../authoring/ingest/policy.js";
import { buildLedgerMatrices } from "../authoring/brain/ledgerMatrices.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "shopify-5cases.json"), "utf8"));
const pol = await loadIngestPolicy();
const ext = skusFromShopifyJson(JSON.stringify(raw), "https://fixture.test", "AED");
const ledger = buildSkuLedger(ext, { sourceActiveSkus: ext.sourceActiveSkus, method: "shopify", autoExcludeCategories: pol.auto_exclude_categories });

const m = buildLedgerMatrices(ledger, raw.products);

// two SEPARATE matrices
assert.ok(m.familyMatrix && m.skuMatrix, "must return familyMatrix AND skuMatrix");
assert.ok(Array.isArray(m.familyMatrix) && Array.isArray(m.skuMatrix), "both matrices are arrays");

// family matrix: one row per non-excluded family, carrying discovery material (structured + text), NOT a merged sku list
const nonExclFamilies = new Set(ledger.skus.filter(s => s.accounting_status !== "excluded").map(s => s.family_id));
assert.equal(m.familyMatrix.length, nonExclFamilies.size, "one familyMatrix row per non-excluded family");
for (const f of m.familyMatrix) {
  assert.ok(f.family_id && f.structured && typeof f.text === "object", "family row has id + structured + text");
  assert.ok(!("skus" in f) && !("variants" in f), "family row must NOT embed skus (two matrices, not one)");
  assert.ok("title" in f.text, "family text carries the title for discovery");
}

// sku matrix: one row per non-excluded SKU, offer attributes; accounting preserved (no variant lost)
const nonExclSkus = ledger.skus.filter(s => s.accounting_status !== "excluded");
assert.equal(m.skuMatrix.length, nonExclSkus.length, "one skuMatrix row per non-excluded SKU (accounting preserved)");
for (const s of m.skuMatrix) {
  assert.ok(s.sku_id && s.family_id, "sku row linked to its family by id (linked, not merged)");
  assert.ok("price" in s && "availability" in s && "buy_url" in s && "option_values" in s, "sku row carries offer attrs");
  assert.ok(!("format" in s) && !("origin" in s), "sku row must NOT carry pre-named decision axes (discovery is later)");
}

// the two matrices are joinable by family_id, and every sku's family exists in the family matrix
const famIds = new Set(m.familyMatrix.map(f => f.family_id));
for (const s of m.skuMatrix) assert.ok(famIds.has(s.family_id), `sku ${s.sku_id} family present in familyMatrix`);

console.log(`PASS — Step 1 two-matrix adapter: ${m.familyMatrix.length} families × ${m.skuMatrix.length} SKUs (separate, linked, accounting preserved).`);
