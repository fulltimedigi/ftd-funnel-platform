/**
 * tests/brain.testfidelity.test.mjs — GUARD: brain tests must consume the REAL ingest, never a matrix
 * reconstructed from the gold. Reconstructing familyMatrix from gold.family_decision_truth used NUMERIC
 * prices, which hid a real regression (the ingest carries STRING prices → the price axis vanished). This
 * guard fails the suite if any brain.*.test.mjs rebuilds the matrix from the gold instead of ingesting.
 * Craft a products.json and run it through ingest (tests/lib/realCatalog.js `craft`) for edge cases.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(HERE).filter((f) => /^brain\..*\.test\.mjs$/.test(f) && f !== "brain.testfidelity.test.mjs");

// the forbidden pattern: building a familyMatrix by mapping over the gold's family_decision_truth.
const FORBIDDEN = /family_decision_truth\s*\.\s*map/;
const offenders = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(HERE, f), "utf8");
  if (FORBIDDEN.test(src)) offenders.push(f);
}
assert.strictEqual(offenders.length, 0,
  "brain tests must ingest a real/crafted products.json, not reconstruct familyMatrix from the gold (that hid the string-price regression): " + offenders.join(", "));

// and every brain test that builds matrices must go through the ingest boundary (realCatalog).
const usesIngest = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(HERE, f), "utf8");
  if (/discoverAxisContracts|buildDecisionTree|buildDecisionProfiles|assignAxisRoles/.test(src)) {
    if (!/realCatalog\.mjs/.test(src)) usesIngest.push(f);
  }
}
assert.strictEqual(usesIngest.length, 0, "brain tests that build matrices must source them from tests/lib/realCatalog.mjs (oudfactory/craft/ingestToMatrices): " + usesIngest.join(", "));

console.log(`PASS — test-fidelity guard: ${files.length} brain tests, none reconstruct the matrix from gold; all source matrices via the real ingest.`);
