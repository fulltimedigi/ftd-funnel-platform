/**
 * tests/ingest.ledger.test.mjs — Part 1 exit suite, WIRED TO THE REAL PIPELINE.
 * ---------------------------------------------------------------------------------------
 * Runs the real ingestCatalog() on the five-case Shopify fixture (injected fetcher) and
 * validates the produced SKU Ledger against the shared exit criteria (tests/lib/ledgerExit.mjs)
 * + case-specific assertions that mirror the documented current-state defects. Also asserts
 * bundle-reachability: the ledger really comes from authoring/ingest/index.js importing skuLedger.
 *
 * RED-FIRST: on the un-fixed pipeline this FAILS (Case A 1-of-4, availability missing,
 * unaccounted>0). After the shopify.js variant fix it is GREEN. Assertions never change.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";
import { ingestCatalog } from "../authoring/ingest/index.js";
import { validateLedger, report } from "./lib/ledgerExit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "policy.json"), "utf8"));
const shopify5 = fs.readFileSync(path.join(HERE, "fixtures", "shopify-5cases.json"), "utf8");
const ORIGIN = "https://fixture.test";

// injected offline fetcher serving the five-case Shopify source
const fetcher = {
  userAgent: "LedgerTestBot/1.0",
  stats: () => ({ minDelayMs: 0, count: 0 }),
  setMinDelay: () => {},
  get: async (url) => {
    if (url === ORIGIN || url === ORIGIN + "/") return { ok: true, text: "<html><body>store</body></html>", finalUrl: ORIGIN + "/" };
    if (url.includes("/robots.txt")) return { ok: false, reason: "http-404" };
    if (url.includes("/products.json")) {
      const page = Number((url.match(/page=(\d+)/) || [])[1] || 1);
      return { ok: true, text: page === 1 ? shopify5 : JSON.stringify({ products: [] }), finalUrl: url };
    }
    return { ok: false, reason: "http-404" };
  },
};

const extra = [];
const ok = (name, pass, detail) => extra.push({ name, pass: !!pass, detail: detail || "" });
const bySub = (skus, sub) => skus.filter((s) => String(s.family_id).includes(sub));

const ing = await ingestCatalog(ORIGIN, { authorized: true, fetcher });
const ledger = ing.ledger;

// bundle-reachability: the real pipeline produced a real ledger (not a stubbed side module)
ok("reachability · ingestCatalog produced a SKU Ledger", !!ledger && Array.isArray(ledger.skus));
ok("reachability · index.js imports skuLedger.js",
  fs.readFileSync(path.join(ROOT, "authoring", "ingest", "index.js"), "utf8").includes('from "./skuLedger.js"'));

// shared exit criteria (ق2/ق7/ق14/ح/ط/ز)
const shared = ledger ? validateLedger(ledger, { policy }) : { checks: [{ name: "ledger exists", pass: false, detail: "no ledger" }], failed: [1] };

// case-specific assertions mirroring documented defects (must be RED before the fix)
if (ledger) {
  const skus = ledger.skus;
  const a = bySub(skus, "royal-attar");
  ok("Case A · 4 size SKUs present, each fold_basis=size", a.length === 4 && a.every((s) => (s.fold_basis || []).includes("size")), `count=${a.length}`);
  ok("Case C · out-of-stock SKU carries availability=out_of_stock", (bySub(skus, "limited-musk")[0] || {}).availability === "out_of_stock");
  ok("Case D · single SKU accounted", bySub(skus, "amber-solo").length === 1);
  ok("Case E · Default Title → no option value", (bySub(skus, "basic-oud")[0] || {}) && Object.keys((bySub(skus, "basic-oud")[0] || {}).option_values || {}).length === 0);
  ok("availability actually captured (not all unknown)", skus.some((s) => s.availability !== "unknown"));

  // poison canary (ق22) — a deliberately corrupted ledger MUST be rejected by the validator.
  // If the validator ever passes this, it is toothless → this check goes RED.
  const poisoned = JSON.parse(JSON.stringify(ledger));
  poisoned.skus = poisoned.skus.filter((s) => !(String(s.sku_id).includes("royal-attar") && !String(s.sku_id).endsWith("1001"))); // drop 3 of 4 A SKUs
  if (poisoned.skus[0]) poisoned.skus[0].option_values = { option1: "Default Title" };
  const pv = validateLedger(poisoned, { policy });
  ok("poison canary · corrupted ledger is REJECTED", pv.failed.length > 0, `poison failures=${pv.failed.length}`);
}

const all = { checks: [...shared.checks, ...extra], failed: [...shared.failed, ...extra.filter((c) => !c.pass)] };
const code = report(all, "[ingest.ledger — REAL pipeline]");
assert.equal(code, 0, "SKU-Ledger exit suite failed (see checks above)");
console.log("PASS — ingest.ledger real-pipeline exit suite green.");
