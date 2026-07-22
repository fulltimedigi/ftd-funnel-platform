/**
 * authoring/ingest/catalog.js — Normalize, dedupe, and report on a catalog.
 * ---------------------------------------------------------------------------
 * Stage 1 (ADR-0013). Merges products from every extraction method into one
 * clean catalog and produces an HONEST coverage report:
 *   - the provenance rule is enforced here: a product without a real http URL is
 *     DROPPED, never kept or invented (rules 3 & 4);
 *   - duplicates (same product URL) collapse to the highest-confidence record,
 *     back-filling any missing fields from the others;
 *   - a "thin" flag marks sites too sparse to build a funnel from — the signal to
 *     fall back to a vertical template rather than fabricate inventory.
 * Pure, Node-safe.
 */

import { isUsableProduct } from "./product.js";

/** Canonical key for dedupe: URL without query/hash, lowercased host. */
function _urlKey(url) {
  try {
    const u = new URL(url);
    return (u.protocol + "//" + u.host.toLowerCase() + u.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return String(url || "").toLowerCase();
  }
}

/** Merge b's non-empty fields into a where a is missing them (a wins otherwise). */
function _backfill(a, b) {
  const out = { ...a };
  for (const k of ["description", "price", "currency", "image", "sku", "brand"]) {
    if ((out[k] == null || out[k] === "") && b[k] != null && b[k] !== "") out[k] = b[k];
  }
  if ((!out.differentiators || out.differentiators.length === 0) && b.differentiators?.length) out.differentiators = b.differentiators;
  out.attributes = { ...(b.attributes || {}), ...(out.attributes || {}) };
  return out;
}

/**
 * Assemble a catalog from one or more product lists.
 * @param {Array<Array>} lists - product arrays from each extractor
 * @param {Object} [opts]
 * @param {number} [opts.thinThreshold=3] - fewer usable products ⇒ thin
 * @returns {{ products: Array, report: Object }}
 */
export function buildCatalog(lists, opts = {}) {
  const thinThreshold = typeof opts.thinThreshold === "number" ? opts.thinThreshold : 3;
  const all = [].concat(...(lists || []));
  const byMethod = {};
  let dropped = 0;

  const map = new Map();
  for (const p of all) {
    if (!isUsableProduct(p)) { dropped++; continue; }
    const key = _urlKey(p.url);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, p);
    } else {
      // Keep the higher-confidence record; back-fill missing fields from the other.
      const [win, lose] = (p.confidence || 0) > (existing.confidence || 0) ? [p, existing] : [existing, p];
      map.set(key, _backfill(win, lose));
    }
  }

  const products = [...map.values()];
  for (const p of products) byMethod[p.method] = (byMethod[p.method] || 0) + 1;

  const withPrice = products.filter((p) => typeof p.price === "number").length;
  const report = {
    total: all.length,
    usable: products.length,
    dropped,                       // usable-rule failures (no real URL / no name)
    duplicatesMerged: all.length - dropped - products.length,
    byMethod,
    withPrice,
    coverage: products.length ? Math.round((withPrice / products.length) * 100) : 0, // % priced
    thin: products.length < thinThreshold,
  };
  return { products, report };
}
