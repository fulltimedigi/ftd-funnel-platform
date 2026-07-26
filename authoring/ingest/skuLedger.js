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

/**
 * Exclusion authority (ق2/ق4/ق19 — closure #1). A SKU becomes `excluded` with a real
 * `signed_exclusion` ONLY via: (أ) merchant confirmation (path M, review queue — not built here),
 * or (ب) an EXPLICIT policy category (config.policy auto_exclude_categories) — reviewable.
 * An automatic guess NOT backed by policy is a `system_exclusion_proposal`: the SKU stays
 * `discovered` (accounted, buyable) pending merchant review — NEVER silently excluded. There are
 * deliberately NO set/gift/box/pack/sample/tester patterns — they risk excluding a real bundle (ق4).
 */
function matchCategory(fam, categories) {
  const hay = `${(fam && fam.title) || ""} ${(fam && fam.product_type) || ""}`;
  for (const c of categories || []) {
    try { if (new RegExp(c.pattern, "i").test(hay)) return c.key; } catch { /* bad pattern → skip */ }
  }
  return null;
}

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
  const autoExcludeCategories = source.autoExcludeCategories || []; // explicit policy categories (path ب)
  const famMap = new Map();
  for (const f of extracted.families || []) if (f && f.family_id && !famMap.has(f.family_id)) famMap.set(f.family_id, f);

  const skuMap = new Map();
  for (const raw of extracted.skus || []) {
    if (!raw || !raw.sku_id || skuMap.has(raw.sku_id)) continue;
    const option_values = cleanOptionValues(raw.option_values);
    const availability = coerceAvailability(raw.availability);
    const fold_basis = Object.keys(option_values).length ? Object.keys(option_values).map((k) => k.toLowerCase()) : null;
    // Exclusion (closure #1): ONLY an explicit policy category grants a signed_exclusion (path ب,
    // reviewable). No policy match ⇒ discovered (buyable), never auto-excluded.
    const fam = famMap.get(raw.family_id) || {};
    const category = matchCategory(fam, autoExcludeCategories);
    const excluded = !!category;
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
      // path ب: policy-authorized + reviewable. Path أ (merchant M) attaches later via the review queue.
      signed_exclusion: excluded ? { reason: `policy auto-exclude category: ${category}`, by: "policy:auto_exclude_categories", basis: "policy", category, reviewable: true } : null,
      system_exclusion_proposal: null,   // set only by non-policy heuristics (none active) → stays discovered pending merchant
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
