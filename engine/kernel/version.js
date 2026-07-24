/**
 * engine/kernel/version.js — deterministic catalog + policy versioning (ADR-0037, Guardrail G2).
 * ---------------------------------------------------------------------------------------------
 * Every SelectionResult carries `catalog_version` and `policy_version`. They are content hashes,
 * so the runtime verifier can tell — cheaply, deterministically, with no clock or randomness —
 * whether the SKU it is about to render still belongs to the catalog the funnel was compiled
 * against, and whether the matching policy is the one that authored it. A mismatch means STALE:
 * re-run the kernel or refuse to render (never render a stale never-relax break).
 *
 * FNV-1a 32-bit — dependency-free, stable across Node and the browser, order-sensitive.
 */

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

/** Stable identity of a product on the axes that matter to matching (url + price + grounded values). */
export function catalogVersion(products) {
  const rows = (products || [])
    .map((p) => `${p.url}|${p.price ?? ""}|${(p.attributes && p.attributes.type) || ""}|${(p.differentiators || []).join(",")}`)
    .sort();
  return "cat_" + fnv1a(rows.join("\n")) + "." + rows.length;
}

/** Stable identity of the matching policy: the typed constraints and their modes/priorities. */
export function policyVersion(constraints) {
  const rows = (constraints || [])
    .map((c) => `${c.id}:${c.type}:${c.mode}:${c.priority || 0}:${(c.order || []).join(">")}`)
    .sort();
  return "pol_" + fnv1a(rows.join("\n"));
}

export default { catalogVersion, policyVersion };
