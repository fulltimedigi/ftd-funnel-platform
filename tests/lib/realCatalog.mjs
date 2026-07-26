/**
 * tests/lib/realCatalog.mjs — the ONE source of familyMatrix/skuMatrix for brain tests: the REAL ingest
 * pipeline (products.json → skusFromShopifyJson → buildSkuLedger → buildLedgerMatrices). Brain tests must
 * NOT hand-build familyMatrix/skuMatrix, and must NOT reconstruct them from the gold — that hid a real
 * price-axis regression (gold prices are numeric; the real ingest carries string prices). Craft a
 * products.json for edge cases if needed, but always run it THROUGH ingest.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadIngestPolicy } from "../../authoring/ingest/policy.js";
import { skusFromShopifyJson } from "../../authoring/ingest/shopify.js";
import { buildSkuLedger } from "../../authoring/ingest/skuLedger.js";
import { buildLedgerMatrices } from "../../authoring/brain/ledgerMatrices.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Ingest a products.json TEXT into {ledger, familyMatrix, skuMatrix} via the real pipeline. */
export async function ingestToMatrices(productsJsonText, origin, currency = "AED") {
  const pol = await loadIngestPolicy();
  const ext = skusFromShopifyJson(productsJsonText, origin, currency);
  const ledger = buildSkuLedger(ext, { sourceActiveSkus: ext.sourceActiveSkus, method: "shopify", autoExcludeCategories: pol.auto_exclude_categories });
  let rawProducts = []; try { rawProducts = JSON.parse(productsJsonText).products || []; } catch { /* empty */ }
  const { familyMatrix, skuMatrix } = buildLedgerMatrices(ledger, rawProducts);
  return { ledger, familyMatrix, skuMatrix };
}

/** The recorded real oudfactory products.json (string prices), ingested. */
export async function oudfactory() {
  const txt = fs.readFileSync(path.join(HERE, "..", "fixtures", "oudfactory.products.json"), "utf8");
  return ingestToMatrices(txt, "https://www.oudfactory.com", "AED");
}

/**
 * Craft a Shopify products.json from a compact family spec and ingest it — for UNIT edge cases (junk
 * tokens, sparse origin, split facets). The point: even crafted inputs go THROUGH the real ingest, so no
 * test hand-builds familyMatrix. Prices are given as STRINGS on purpose (mirrors real Shopify payloads).
 * spec: [{ handle, title, type, desc?, tags?, variants:[{title, price, available?}] }]
 */
export async function craft(families, origin = "https://crafted.test", currency = "USD") {
  const products = families.map((f) => ({
    handle: f.handle, title: f.title, body_html: f.desc || "", vendor: f.vendor || "Acme",
    product_type: f.type || "", tags: f.tags || [], options: [{ name: "Variant" }],
    variants: (f.variants || [{ title: "Default Title", price: "0" }]).map((v, i) => ({
      id: `${f.handle}-${i}`, title: v.title, price: String(v.price), available: v.available !== false, option1: v.title,
    })),
  }));
  return ingestToMatrices(JSON.stringify({ products }), origin, currency);
}
