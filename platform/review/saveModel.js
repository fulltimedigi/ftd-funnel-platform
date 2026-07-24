/**
 * platform/review/saveModel.js — PURE helpers for "save this draft to my account".
 * ---------------------------------------------------------------------------
 * The generated config carries brand.name + id but NO url field — the store URL
 * lives outside it (stashed by the intake screen on first save, or the funnel
 * row's store_url when re-opened from the dashboard). These resolvers make the
 * save name/URL deterministic and unit-testable, so the re-open→re-save path
 * can't silently lose the store URL.
 */

/** The store URL to record: the stashed/opened URL wins; fall back to any on-config value. */
export function draftStoreUrl(config, stashedUrl) {
  const s = stashedUrl != null ? String(stashedUrl).trim() : "";
  if (s) return s;
  const onCfg = config && config.store_url ? String(config.store_url).trim() : "";
  return onCfg || "";
}

/** A human name for the funnel: brand name → config id → store URL → generic. */
export function draftName(config, storeUrl) {
  const brand = config && config.brand && config.brand.name ? String(config.brand.name).trim() : "";
  if (brand) return brand;
  const id = config && config.id ? String(config.id).trim() : "";
  if (id) return id;
  const url = storeUrl ? String(storeUrl).trim() : "";
  return url || "فانل جديد";
}

export default { draftStoreUrl, draftName };
