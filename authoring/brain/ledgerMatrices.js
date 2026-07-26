/**
 * authoring/brain/ledgerMatrices.js — Part-2 brain, BUILD STEP 1: the two-matrix Ledger adapter.
 * ---------------------------------------------------------------------------------------------
 * Turns the Part-1 SKU Ledger into TWO SEPARATE matrices (arbitration rule "مصفوفتان لا واحدة"):
 *   • familyMatrix — one row per non-excluded FAMILY, carrying the raw discovery material
 *     (structured fields + text). NO pre-named decision axes here — discovery/naming is a later
 *     step (results-first, ق1/ق10). NO embedded sku list (merging re-hides Part-1 accounting).
 *   • skuMatrix — one row per non-excluded SKU with its OFFER attributes (price/availability/
 *     buy_url/option_values). Linked to its family by family_id, never merged.
 * Excluded SKUs (signed) are omitted from both but remain accounted-for in the Ledger.
 * Pure, deterministic, dependency-free.
 */

export function buildLedgerMatrices(ledger, rawProducts = []) {
  const rawByHandle = new Map();
  for (const p of rawProducts || []) if (p && p.handle) rawByHandle.set(p.handle, p);
  const strip = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  const skus = (ledger.skus || []).filter((s) => s.accounting_status !== "excluded");
  const famById = new Map((ledger.families || []).map((f) => [f.family_id, f]));

  // family matrix — one row per family that still has a non-excluded SKU
  const familyIds = [...new Set(skus.map((s) => s.family_id))];
  const familyMatrix = familyIds.map((fid) => {
    const f = famById.get(fid) || {};
    const raw = rawByHandle.get(fid) || {};
    const tags = Array.isArray(raw.tags) ? raw.tags : (typeof raw.tags === "string" ? raw.tags.split(",").map((t) => t.trim()).filter(Boolean) : []);
    return {
      family_id: fid,
      url: f.url || null,
      structured: { product_type: f.product_type || raw.product_type || null, brand: f.brand || raw.vendor || null, tags },
      text: { title: f.title || raw.title || "", description: strip(raw.body_html) },
      // raw price observations across this family's variants (band discovery happens later, not here).
      // TYPE CONTRACT (matrix boundary): a present price MUST already be a finite number (normalized at
      // ingest). A non-numeric price is an EXPLICIT failure here — never a silent filter that would make
      // the price decision axis vanish. Absent (null) prices are legitimate and simply omitted.
      prices: skus.filter((s) => s.family_id === fid).map((s) => s.price).filter((n) => n != null).map((n) => {
        if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`ledgerMatrices price contract: expected a normalized numeric price, got ${JSON.stringify(n)} for family ${fid} — normalize at the ingest boundary (silent drop forbidden)`);
        return n;
      }),
    };
  });

  // sku matrix — one row per non-excluded SKU (offer attributes only)
  const skuMatrix = skus.map((s) => ({
    sku_id: s.sku_id,
    family_id: s.family_id,
    price: s.price != null ? Number(s.price) : null,
    currency: s.currency || null,
    availability: s.availability,
    buy_url: s.buy_url,
    option_values: s.option_values || {},
  }));

  return { familyMatrix, skuMatrix };
}
