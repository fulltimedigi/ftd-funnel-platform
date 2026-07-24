/**
 * engine/kernel/handoff.js — the CTA handoff target (ADR-0037 closing, item 2).
 * ===========================================================================================
 * The CTA must lead to the PROVEN product/variant — the exact SKU the SelectionResult certifies.
 * There is NO silent fallback to a parent/generic/brand-home link when the chosen variant isn't
 * deep-linkable: the only correct state then is HANDOFF_UNBOUND — a first-class base state the UI
 * surfaces honestly ("view on the store" without a fake deep link), never a parent-page redirect
 * dressed up as the product. Pure, deterministic.
 */

export function handoffTarget(product, variant) {
  const url = (variant && variant.url) || (product && product.url) || null;
  if (!url || !/^https?:\/\//i.test(String(url))) {
    return { state: "HANDOFF_UNBOUND", url: null, reason: "no deep-linkable product/variant url" };
  }
  return { state: "BOUND", url, variant_id: (variant && variant.id) || null };
}

export default { handoffTarget };
