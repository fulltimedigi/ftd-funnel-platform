/**
 * tests/ingest.ledger.e2e.test.mjs — production-entry E2E for the SKU Ledger (Part 1 close-out).
 * Drives generateFunnelFromUrl() — the exact core the Netlify generate-background function calls —
 * end to end with an injected fetcher, and asserts the Ledger reaches the result with full
 * accounting. Also covers the JSON-LD availability path (the "6th case"): a schema.org OutOfStock
 * offer must surface as availability=out_of_stock in the ledger (no fabricated 'available').
 * Fails if the variants[0] regression, the ledger passthrough, or JSON-LD availability breaks.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";
import { generateFunnelFromUrl } from "../authoring/index.js";
import { ingestCatalog } from "../authoring/ingest/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const shopify5 = fs.readFileSync(path.join(HERE, "fixtures", "shopify-5cases.json"), "utf8");
const ORIGIN = "https://fixture.test";

// ---- 1) Shopify path: generateFunnelFromUrl carries a fully-accounted ledger ----
const shopFetcher = {
  userAgent: "E2EBot/1.0", stats: () => ({ minDelayMs: 0, count: 0 }), setMinDelay: () => {},
  get: async (u) => {
    if (u === ORIGIN || u === ORIGIN + "/") return { ok: true, text: "<html><body>store</body></html>", finalUrl: ORIGIN + "/" };
    if (u.includes("/robots.txt")) return { ok: false, reason: "http-404" };
    if (u.includes("/products.json")) { const page = Number((u.match(/page=(\d+)/) || [])[1] || 1); return { ok: true, text: page === 1 ? shopify5 : JSON.stringify({ products: [] }), finalUrl: u }; }
    return { ok: false, reason: "http-404" };
  },
};
const gen = await generateFunnelFromUrl(ORIGIN, { authorized: true, fetcher: shopFetcher });
assert.ok(gen.ledger, "generateFunnelFromUrl must carry the SKU ledger (production-entry passthrough)");
assert.equal(gen.ledger.accounting.unaccounted_active_skus, 0, "unaccounted must be 0 at the production entry");
assert.equal(gen.ledger.accounting.active_skus, 8, "source oracle = 8 SKUs (all 5 variants + singles)");
console.log("  ✓ Shopify E2E: ledger reaches generateFunnelFromUrl, unaccounted=0, active=8");

// ---- 2) JSON-LD availability path (6th case): OutOfStock offer -> availability=out_of_stock ----
const ldHtml = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Product", name: "Discontinued Musk",
  offers: { "@type": "Offer", price: "40.00", priceCurrency: "KWD", url: ORIGIN + "/products/discontinued-musk", availability: "https://schema.org/OutOfStock" },
})}</script></head><body>x</body></html>`;
const ldFetcher = {
  userAgent: "E2EBot/1.0", stats: () => ({ minDelayMs: 0, count: 0 }), setMinDelay: () => {},
  get: async (u) => {
    if (u === ORIGIN || u === ORIGIN + "/") return { ok: true, text: ldHtml, finalUrl: ORIGIN + "/" };
    if (u.includes("/robots.txt")) return { ok: false, reason: "http-404" };
    if (u.includes("/products.json")) return { ok: true, text: JSON.stringify({ notShopify: true }), finalUrl: u }; // not shopify → JSON-LD path
    if (u.includes("sitemap")) return { ok: false, reason: "http-404" };
    return { ok: false, reason: "http-404" };
  },
};
const ing = await ingestCatalog(ORIGIN, { authorized: true, fetcher: ldFetcher });
const musk = (ing.ledger.skus || []).find((s) => String(s.family_id).includes("discontinued-musk"));
assert.ok(musk, "JSON-LD product must reach the ledger as a single SKU (extraction_method json-ld)");
assert.equal(musk.availability, "out_of_stock", "JSON-LD OutOfStock offer must surface as out_of_stock (no fabricated 'available')");
console.log("  ✓ JSON-LD E2E: OutOfStock offer -> availability=out_of_stock");

console.log("PASS — ingest.ledger production-entry E2E green.");
