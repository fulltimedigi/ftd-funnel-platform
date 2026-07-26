/**
 * tests/brain.goldpin.test.mjs — enforce the frozen-set pins + a shrinkage canary. Guards the whole
 * suite: every "hard=0 / silent=0 / exact=ceiling" number is only meaningful against the EXACT frozen
 * corpus. A truncated or edited gold must fail HERE, immediately, not silently pass elsewhere.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";
import { assertGoldPinned, PINS } from "./lib/goldPin.mjs";
import { oudfactory } from "./lib/realCatalog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const goldText = fs.readFileSync(path.join(HERE, "fixtures", "gold-set.json"), "utf8");
const gold = JSON.parse(goldText);

// (1) the real gold matches every pin (shape + content hash)
assertGoldPinned(gold, goldText);

// (2) the real-ingest frozen counts hold (a truncated/expanded catalog is caught)
const { familyMatrix, skuMatrix, ledger } = await oudfactory();
assert.strictEqual(familyMatrix.length, PINS.oud_families, `oudfactory families ${familyMatrix.length} !== ${PINS.oud_families}`);
assert.strictEqual(skuMatrix.length, PINS.oud_skus, `oudfactory non-excluded SKUs ${skuMatrix.length} !== ${PINS.oud_skus}`);
assert.strictEqual(ledger.accounting.active_skus, PINS.oud_active_skus, `oudfactory active SKUs ${ledger.accounting.active_skus} !== ${PINS.oud_active_skus}`);

// (3) SHRINKAGE CANARY — truncate the corpus to 3 intents; the pin MUST catch it (a check that never saw
// its own failure is not tested).
let caught = false;
try { const shrunk = { ...gold, intents: gold.intents.slice(0, 3) }; assertGoldPinned(shrunk, JSON.stringify(shrunk)); }
catch { caught = true; }
assert.ok(caught, "shrinkage canary: a 3-intent truncated corpus MUST fail the pin (else the pin is untested)");

// (4) HASH CANARY — a one-byte edit must be caught by the content hash
let hashCaught = false;
try { assertGoldPinned(gold, goldText + " "); } catch { hashCaught = true; }
assert.ok(hashCaught, "hash canary: any edit to the frozen gold must fail the content-hash pin");

console.log(`PASS — gold pins: ${PINS.intents} intents / ${PINS.exact} EXACT / ${PINS.gold_version} / sha OK · oudfactory ${PINS.oud_families}f·${PINS.oud_skus}sku · shrinkage+hash canaries catch truncation/edits.`);
