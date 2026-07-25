/**
 * tests/ingest.ledger.harness.mjs — STANDALONE poison-canary demo for Part 1 (constitution ق22).
 * Validates the reference ledger fixture via the SHARED validator (tests/lib/ledgerExit.mjs) — one
 * source of truth. Used for the manual red→green proof; the WIRED suite is tests/ingest.ledger.test.mjs.
 *
 *   GREEN : node tests/ingest.ledger.harness.mjs
 *   RED   : node tests/ingest.ledger.harness.mjs --poison   (deliberate break must fail)
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateLedger, report } from "./lib/ledgerExit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "policy.json"), "utf8"));
const ledger = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "sku-ledger.expected.json"), "utf8"));

if (process.argv.includes("--poison")) {
  // (1) drop a real source SKU → recomputed unaccounted > 0 ; (2) leak "Default Title" as an option
  ledger.skus = ledger.skus.filter((s) => s.sku_id !== "royal-attar::24ml");
  const basic = ledger.skus.find((s) => s.sku_id === "basic-oud::default");
  if (basic) basic.option_values = { option1: "Default Title" };
}

const code = report(validateLedger(ledger, { policy }), process.argv.includes("--poison") ? "[POISON — must be RED]" : "[baseline — must be GREEN]");
process.exit(code);
