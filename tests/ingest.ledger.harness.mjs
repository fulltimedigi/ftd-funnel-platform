/**
 * tests/ingest.ledger.harness.mjs — STEP-0 exit-suite harness for Part 1 (SKU Ledger).
 * ---------------------------------------------------------------------------------------
 * This is the negative-fixture + poison-canary harness that must prove it HAS TEETH before
 * the Step-1 implementation is written (constitution ق22: "poison canary — كسر متعمَّد يجب
 * أن يحمّر"). It validates the reference ledger (tests/fixtures/sku-ledger.expected.json)
 * against the Part-1 exit criteria. The validator is INDEPENDENT (ق22): it re-derives the
 * accounting from the SOURCE counter and never trusts the ledger's own stored numbers.
 *
 * Run GREEN : node tests/ingest.ledger.harness.mjs
 * Run RED   : node tests/ingest.ledger.harness.mjs --poison   (deliberate break must fail)
 *
 * NOT wired into `npm test` yet — Step 1 will point the same assertions at the REAL
 * skuLedger.js output and add it to the suite. Standalone for the Step-0 canary proof.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AVAIL_ENUM = new Set(["available", "out_of_stock", "preorder", "backorder", "unknown"]);
const POISON = process.argv.includes("--poison");

function loadLedger() {
  const raw = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "sku-ledger.expected.json"), "utf8"));
  if (!POISON) return raw;
  // ---- DELIBERATE BREAK (poison canary) — two independent violations ----
  // (1) drop a real source SKU → the source counter (8) no longer matches accounted → unaccounted>0
  raw.skus = raw.skus.filter((s) => s.sku_id !== "royal-attar::24ml");
  // (2) leak Shopify's "Default Title" as an OPTION VALUE (forbidden by decision ز/E)
  const basic = raw.skus.find((s) => s.sku_id === "basic-oud::default");
  if (basic) basic.option_values = { option1: "Default Title" };
  return raw;
}

const checks = [];
const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail || "" });

function validate(L) {
  const src = (L.source && L.source.active_skus) || 0;
  const skus = L.skus || [];

  // أ) accounting re-derived from the SOURCE counter, not the ledger's stored number
  const accounted = skus.filter((s) => s.accounting_status === "discovered" || s.accounting_status === "excluded").length;
  const unaccounted = src - accounted;
  ok("ق2 · accounting from SOURCE counter (active_skus === source)", (L.accounting && L.accounting.active_skus) === src, `ledger=${L.accounting && L.accounting.active_skus} source=${src}`);
  ok("ق2 · Unaccounted active SKUs = 0 (recomputed)", unaccounted === 0 || L.accounting.structural_incompleteness === true, `recomputed unaccounted=${unaccounted}`);

  // ب) structural incompleteness never hidden
  ok("ق2 · page-cap → structural_incompleteness declared (no false zero)", !(L.source && L.source.page_capped) || L.accounting.structural_incompleteness === true, `page_capped=${L.source && L.source.page_capped}`);

  // ح) accounting_status enum only (roles filled later)
  ok("ح · accounting_status ∈ {discovered,excluded}", skus.every((s) => s.accounting_status === "discovered" || s.accounting_status === "excluded"));

  // ط) availability 5-enum; unknown ≠ sellable
  ok("ط · availability ∈ 5-enum", skus.every((s) => AVAIL_ENUM.has(s.availability)));
  ok("ط · unknown ≠ sellable (no buy_url on unknown)", skus.every((s) => s.availability !== "unknown" || !s.buy_url));

  // ز/E) NEGATIVE FIXTURE — "Default Title" must NEVER be an option value
  const leaks = skus.filter((s) => Object.values(s.option_values || {}).some((v) => String(v).trim().toLowerCase() === "default title"));
  ok("ز/E · no 'Default Title' as an option value (negative fixture)", leaks.length === 0, leaks.length ? `leaked in: ${leaks.map((s) => s.sku_id).join(", ")}` : "");

  // Case C — out-of-stock captured
  ok("ق14 · out-of-stock SKU carries availability=out_of_stock", (skus.find((s) => s.sku_id === "limited-musk::10ml") || {}).availability === "out_of_stock");

  // Case A — 4 size SKUs, each folded on size
  const a = skus.filter((s) => s.family_id === "royal-attar");
  ok("ق2/ق4 · Case A: all 4 size SKUs present + fold_basis=size", a.length === 4 && a.every((s) => (s.fold_basis || []).includes("size")), `count=${a.length}`);
}

validate(loadLedger());

const failed = checks.filter((c) => !c.pass);
console.log(`\n=== SKU-Ledger exit harness ${POISON ? "[POISON — must be RED]" : "[baseline — must be GREEN]"} ===`);
for (const c of checks) console.log(`  ${c.pass ? "✓" : "✗ FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`);
console.log(`\n${failed.length ? "❌ RED — " + failed.length + " check(s) failed" : "✅ GREEN — all " + checks.length + " checks passed"}\n`);
process.exit(failed.length ? 1 : 0);
