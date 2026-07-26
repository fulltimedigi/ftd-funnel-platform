/**
 * tests/gold.consistency.test.mjs — invariants that keep the gold set internally honest (closure).
 * A repeated table-vs-file contradiction (bundle_content) proved a derived field can silently drift.
 * These assertions turn any such drift into a RED build:
 *   1. review_queue.bundles content/evidence == family_decision_truth (same source, no divergence)
 *   2. no is_bundle family leaks into any intent's accepted_skus (bundles are out of single-format, ق4)
 *   3. every intent.expected is a non-empty subset of the allowed outcome vocabulary
 * Wired into npm test.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "gold-set.json"), "utf8"));
const ftBundles = new Map(gold.family_decision_truth.filter((f) => f.is_bundle).map((f) => [f.name, f]));
const VOCAB = new Set(["EXACT", "HONEST_NO_MATCH", "DISCLOSED_COMPROMISE"]);

// 1) review_queue.bundles must agree with family_decision_truth (no table-vs-file drift)
for (const b of gold.review_queue.bundles) {
  const f = ftBundles.get(b.name);
  assert.ok(f, `bundle '${b.name}' in review_queue missing from family_decision_truth`);
  assert.equal(b.content, f.bundle_content, `bundle_content drift for '${b.name}': review_queue='${b.content}' vs family_truth='${f.bundle_content}'`);
}
assert.equal(gold.review_queue.bundles.length, ftBundles.size, "review_queue.bundles count != is_bundle families");

// 2) no bundle SKU may sit in a single-format intent's accepted_skus
const bundleFamilies = new Set(gold.family_decision_truth.filter((f) => f.is_bundle).map((f) => f.family));
const skuFamily = new Map(gold.sku_offer_truth.map((s) => [s.sku, s.family]));
for (const it of gold.intents) for (const sku of it.accepted_skus || []) {
  assert.ok(!bundleFamilies.has(skuFamily.get(sku)), `bundle SKU '${sku}' leaked into single-format intent '${it.id}'`);
}

// 3) expected is a non-empty subset of the allowed vocabulary
for (const it of gold.intents) {
  assert.ok(Array.isArray(it.expected) && it.expected.length >= 1, `intent '${it.id}' expected must be a non-empty set`);
  for (const e of it.expected) assert.ok(VOCAB.has(e), `intent '${it.id}' has invalid expected '${e}'`);
}

console.log(`PASS — gold-set consistency (${gold.review_queue.bundles.length} bundles, ${gold.intents.length} intents) — no table/file drift.`);
