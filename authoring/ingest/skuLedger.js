/**
 * authoring/ingest/skuLedger.js — the SKU Ledger assembler (Part 1, results-first constitution
 * ق2/ق3/ق4/ق7). Turns extracted {families, skus} + the SOURCE active-SKU counter into a
 * deterministic ledger with FULL accounting: every active SKU is `discovered` (or a signed
 * `excluded`), and `unaccounted` is derived against the source counter — never a false zero.
 *
 * Source-agnostic: works for Shopify (many variants) and for variant-less sources (JSON-LD →
 * one SKU per product, `extraction_method` recorded). NO semantic option classification here
 * (decision ي — that is Part 2); this layer only CAPTURES structural truth.
 *
 * Pure, deterministic, dependency-free.
 */

const AVAIL_ENUM = new Set(["available", "out_of_stock", "preorder", "backorder", "unknown"]);
const NO_OPTION_SENTINEL = "default title"; // Shopify's no-options variant name

/** Non-products (gift cards / samples / shipping / warranty / subscriptions) — signed out of the
 *  buyable set (ق2). Literal here in the ingest/ledger layer (mirrors the brain's cleanCatalog;
 *  the ledger OWNS exclusion-signing so a dropped SKU is accounted-for, not silently lost). */
const NON_PRODUCT = /gift\s*-?\s*card|e-?\s*gift|\bvoucher\b|\bsample\b|\btester\b|\bshipping\b|\bwarranty\b|\bsubscription\b/i;

/** Coerce any availability signal into the 5-state enum (unknown when unsure — never guessed). */
function coerceAvailability(a) {
  const s = String(a || "").trim().toLowerCase();
  return AVAIL_ENUM.has(s) ? s : "unknown";
}

/** Strip Shopify's "Default Title" sentinel from option values (decision ز): it means NO options. */
function cleanOptionValues(ov) {
  const out = {};
  for (const [k, v] of Object.entries(ov || {})) {
    if (String(v).trim().toLowerCase() === NO_OPTION_SENTINEL) continue; // never store the sentinel
    if (String(k).trim().toLowerCase() === "title") continue;            // the no-options dimension
    out[k] = v;
  }
  return out;
}

/**
 * @param {{families:Array, skus:Array}} extracted
 * @param {{sourceActiveSkus:number, pageCapped?:boolean, method?:string}} source
 * @returns {object} the SKU Ledger
 */
export function buildSkuLedger(extracted = {}, source = {}) {
  const famMap = new Map();
  for (const f of extracted.families || []) if (f && f.family_id && !famMap.has(f.family_id)) famMap.set(f.family_id, f);

  const skuMap = new Map();
  for (const raw of extracted.skus || []) {
    if (!raw || !raw.sku_id || skuMap.has(raw.sku_id)) continue;
    const option_values = cleanOptionValues(raw.option_values);
    const availability = coerceAvailability(raw.availability);
    const fold_basis = Object.keys(option_values).length ? Object.keys(option_values).map((k) => k.toLowerCase()) : null;
    // signed exclusion for non-products (ق2): a dropped SKU is ACCOUNTED-FOR via a signed record,
    // never silently absent. Basis = the family's title + product_type (the same signal cleanCatalog uses).
    const fam = famMap.get(raw.family_id) || {};
    const nonProduct = NON_PRODUCT.test(`${fam.title || ""} ${fam.product_type || ""}`);
    const excluded = nonProduct;
    skuMap.set(raw.sku_id, {
      sku_id: raw.sku_id,
      family_id: raw.family_id || null,
      variant_title: raw.variant_title || null,
      option_values,
      price: raw.price != null ? raw.price : null,
      currency: raw.currency || null,
      availability,
      // unknown ≠ sellable (ق7/ق14); an excluded SKU is not buyable either
      buy_url: (availability === "unknown" || excluded) ? null : (raw.buy_url || null),
      sku_code: raw.sku_code || null,
      accounting_status: excluded ? "excluded" : "discovered",   // (ح)
      roles: [],
      fold_basis,
      bundle_class: "pending",           // (ي) — semantic classification deferred to Part 2
      signed_exclusion: excluded ? { reason: "non-product (gift-card/sample/shipping/warranty/subscription)", by: "ingest:skuLedger", basis: "NON_PRODUCT" } : null,
      path_witness: null,                // (هـ) — generated compile-time (Part 3)
    });
  }

  const skus = [...skuMap.values()];
  const active_skus = Number(source.sourceActiveSkus || 0);
  const accounted = skus.filter((s) => s.accounting_status === "discovered" || s.accounting_status === "excluded").length;
  const excluded = skus.filter((s) => s.accounting_status === "excluded").length;

  return {
    source: { method: source.method || "unknown", active_skus, page_capped: !!source.pageCapped },
    families: [...famMap.values()],
    skus,
    accounting: {
      active_skus,
      accounted,
      excluded,
      unaccounted_active_skus: active_skus - accounted,
      structural_incompleteness: !!source.pageCapped,
    },
  };
}
