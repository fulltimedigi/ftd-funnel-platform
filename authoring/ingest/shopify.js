/**
 * authoring/ingest/shopify.js — Shopify public products.json adapter.
 * ---------------------------------------------------------------------------
 * Stage 1 (ADR-0013), best-first extraction #2. Shopify stores expose a public
 * `/products.json` (up to 250/page via ?limit=&page=) and
 * `/collections/<handle>/products.json`. Clean structured data — no HTML parsing.
 *
 * This module is pure: it turns products.json TEXT into canonical records and
 * builds the page URLs. The polite fetcher (with robots.txt already checked) does
 * the actual GETs. Pure, Node-safe.
 */

import { makeProduct, stripTags } from "./product.js";

/** Build the paginated products.json URL for a store origin. */
export function productsJsonUrl(origin, page = 1, limit = 250) {
  const base = String(origin || "").replace(/\/+$/, "");
  return `${base}/products.json?limit=${limit}&page=${page}`;
}

/** Heuristic: does this JSON text look like a Shopify products.json payload? */
export function looksLikeShopify(jsonText) {
  if (typeof jsonText !== "string") return false;
  try {
    const d = JSON.parse(jsonText);
    return !!(d && Array.isArray(d.products) && (d.products.length === 0 || d.products[0].handle !== undefined));
  } catch { return false; }
}

/**
 * Parse a products.json payload into canonical records with real product URLs.
 * @param {string} jsonText - the /products.json response body
 * @param {string} origin   - store origin, e.g. "https://shop.example" (for product URLs)
 * @param {string} [currency] - shop currency (products.json omits it), optional
 * @returns {Array} canonical products (may be empty)
 */
export function productsFromShopifyJson(jsonText, origin, currency = null) {
  let data;
  try { data = JSON.parse(jsonText); } catch { return []; }
  if (!data || !Array.isArray(data.products)) return [];

  const base = String(origin || "").replace(/\/+$/, "");
  const out = [];
  for (const p of data.products) {
    if (!p || !p.handle) continue;
    const variant = Array.isArray(p.variants) && p.variants[0] ? p.variants[0] : {};
    const image = Array.isArray(p.images) && p.images[0] ? (p.images[0].src || null) : (p.image && p.image.src) || null;
    const tags = Array.isArray(p.tags) ? p.tags : (typeof p.tags === "string" ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : []);
    out.push(makeProduct({
      name: p.title,
      description: stripTags(p.body_html || ""),
      price: variant.price != null ? variant.price : null,
      currency,
      url: `${base}/products/${p.handle}`,
      image,
      sku: variant.sku || null,
      brand: p.vendor || null,
      attributes: p.product_type ? { type: p.product_type } : {},
      differentiators: tags,
      sourceUrl: `${base}/products/${p.handle}`,
      method: "shopify",
      confidence: 0.95,
    }));
  }
  return out;
}

/**
 * SKU-level extraction (Part 1, ق2/ق3): every Shopify VARIANT becomes an active SKU under its
 * product FAMILY — no variant is dropped (the fix for the shopify.js:variants[0] loss). Captures
 * option_values (by option NAME), availability, per-variant buy URL, and the source SKU count.
 * Does NOT classify option meaning (decision ي — that is Part 2). Pure; does not touch
 * productsFromShopifyJson (backward compatible).
 * @returns {{families:Array, skus:Array, sourceActiveSkus:number}}
 */
export function skusFromShopifyJson(jsonText, origin, currency = null) {
  let data;
  try { data = JSON.parse(jsonText); } catch { return { families: [], skus: [], sourceActiveSkus: 0 }; }
  if (!data || !Array.isArray(data.products)) return { families: [], skus: [], sourceActiveSkus: 0 };

  const base = String(origin || "").replace(/\/+$/, "");
  const families = [];
  const skus = [];
  let sourceActiveSkus = 0;

  for (const p of data.products) {
    if (!p || !p.handle) continue;
    const url = `${base}/products/${p.handle}`;
    families.push({
      family_id: p.handle, title: p.title || "", url,
      brand: p.vendor || null, product_type: p.product_type || null, extraction_method: "shopify",
    });
    // option position → name (Shopify: options:[{name,position}], variant.option1/2/3)
    const optNames = Array.isArray(p.options) ? p.options.map((o) => o && o.name).filter(Boolean) : [];
    const variants = Array.isArray(p.variants) ? p.variants : [];
    sourceActiveSkus += variants.length;
    variants.forEach((v, i) => {
      const option_values = {};
      for (let k = 0; k < 3; k++) {
        const name = optNames[k];
        const val = v["option" + (k + 1)];
        if (name && val != null && String(val).trim() !== "") option_values[name] = String(val).trim();
      }
      skus.push({
        sku_id: `${p.handle}::${v.id != null ? v.id : i}`,
        family_id: p.handle,
        variant_title: v.title != null ? String(v.title) : null,
        option_values, // keyed by option NAME; skuLedger strips the "Default Title" sentinel
        price: v.price != null ? v.price : null,
        currency,
        availability: v.available === true ? "available" : v.available === false ? "out_of_stock" : "unknown",
        buy_url: v.id != null ? `${url}?variant=${v.id}` : url,
        sku_code: v.sku || null,
      });
    });
  }
  return { families, skus, sourceActiveSkus };
}
