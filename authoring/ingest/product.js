/**
 * authoring/ingest/product.js — Canonical catalog product shape + small utils.
 * ---------------------------------------------------------------------------
 * Stage 1 (ADR-0013). Every extractor emits this one shape so the normalizer can
 * merge/dedupe across methods. Provenance is first-class: `url` (the real product
 * URL) and `sourceUrl` (where we read it) are what make a product non-fabricated.
 * Pure, Node-safe.
 */

/** Strip HTML tags → plain text (collapse whitespace). */
export function stripTags(html) {
  if (typeof html !== "string") return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Parse a price into a number. Accepts 12, "12.00", "$1,299.99", "1.299,50 د.ك"(→ best-effort).
 * Returns null when no numeric value is present (never guesses).
 */
export function parsePrice(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,]/g, "").trim();
  // Drop stray leading/trailing separators (e.g. the dot inside "د.ك" currency text).
  s = s.replace(/^[.,]+/, "").replace(/[.,]+$/, "");
  if (!s) return null;
  // If both separators present, assume the LAST one is the decimal separator.
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    // lone comma: decimal if it looks like ",dd", else thousands
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/** Build the canonical product record with safe defaults. */
export function makeProduct(f = {}) {
  const price = f.price != null && f.price !== "" ? parsePrice(f.price) : null;
  return {
    name: (f.name || "").toString().trim(),
    description: (f.description || "").toString().trim(),
    price,
    currency: f.currency ? String(f.currency).trim() : null,
    url: (f.url || "").toString().trim(),
    image: f.image ? String(f.image).trim() : null,
    sku: f.sku != null && f.sku !== "" ? String(f.sku).trim() : null,
    brand: f.brand ? String(f.brand).trim() : null,
    attributes: f.attributes && typeof f.attributes === "object" ? f.attributes : {},
    differentiators: Array.isArray(f.differentiators) ? f.differentiators.filter(Boolean) : [],
    sourceUrl: (f.sourceUrl || f.url || "").toString().trim(),
    method: f.method || "unknown",
    confidence: typeof f.confidence === "number" ? f.confidence : 0.5,
  };
}

/**
 * A product is usable only if it has a name AND a real (http) URL — the
 * provenance rule (no product without a real link; ADR-0013, no fabrication).
 */
export function isUsableProduct(p) {
  return !!(p && p.name && typeof p.url === "string" && /^https?:\/\//i.test(p.url));
}
