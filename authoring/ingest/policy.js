/**
 * authoring/ingest/policy.js — load the versioned ingestion policy (config/policy.json).
 * ---------------------------------------------------------------------------------------
 * Tunable limits live in config/policy.json (constitution §سادسًا) — never buried in code.
 * In Node (the production background function + tests) this reads the file; in the browser
 * (the same-origin sample path) it falls back to identical literal defaults. Browser-safe:
 * the node:fs import is dynamic and only reached under a Node guard, so it never loads in a
 * browser. Cached after first load.
 */

const DEFAULTS = Object.freeze({
  max_shopify_pages: 5,
  max_sitemaps: 10,
  max_product_pages: 50,
  availability_states: ["available", "out_of_stock", "preorder", "backorder", "unknown"],
  sellable_states: ["available"],
  shopify_no_option_sentinel: "Default Title",
  auto_exclude_categories: [
    { key: "gift_card", pattern: "gift\\s*-?\\s*card|e-?\\s*gift|\\bvoucher\\b" },
    { key: "shipping", pattern: "\\bshipping\\b|\\bdelivery fee\\b" },
    { key: "warranty", pattern: "\\bwarranty\\b|\\bprotection plan\\b" },
    { key: "subscription", pattern: "\\bsubscription\\b" },
  ],
});

let _cache = null;

export async function loadIngestPolicy() {
  if (_cache) return _cache;
  let p = { ...DEFAULTS };
  try {
    if (typeof process !== "undefined" && process.versions && process.versions.node) {
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const nodePath = await import("node:path");
      const here = nodePath.dirname(fileURLToPath(import.meta.url));
      const file = nodePath.join(here, "..", "..", "config", "policy.json");
      const j = JSON.parse(readFileSync(file, "utf8"));
      if (j && j.ingestion) p = { ...p, ...j.ingestion };
    }
  } catch { /* fall back to identical defaults — honest, never throws */ }
  _cache = Object.freeze(p);
  return _cache;
}
