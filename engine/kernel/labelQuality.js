/**
 * engine/kernel/labelQuality.js — deterministic guard that a user-facing option LABEL is a
 * meaningful decision attribute, not a mined fragment / function word / boilerplate / bare unit.
 * ---------------------------------------------------------------------------------------------
 * P0 stop-gap for the authoring layer (FUNNEL-QUALITY-FIX-PLAN). Raw keyword-mined "facet"
 * tokens leaked to shoppers as choices — e.g. "de" (from "Eau De Parfum"), "based", "packages".
 * "Grounded" they may be (the token IS in the text) but they map to NO understandable attribute,
 * which breaks the Promise (a label must correspond to a real, comprehensible characteristic).
 *
 * This module only REFUSES obvious junk; it does not translate or design axes — that is the
 * LLM's job at authoring time (P1). Two uses:
 *   • authoring drops a mined taste axis whose options don't survive `meaningfulOptions`;
 *   • the publish-time verifier FAILS the build if any junk label survives to a question.
 * Pure/Node-safe. NOT a stopword whack-a-mole substitute for P1 — a floor, not the ceiling.
 */

// Latin function words + commerce/packaging boilerplate that are never a decision ATTRIBUTE.
const JUNK = new Set([
  "de", "du", "des", "la", "le", "les", "el", "of", "the", "and", "or", "for", "with", "by", "to", "in", "on", "an",
  "eau", "based", "pack", "packs", "package", "packages", "box", "boxes", "set", "sets", "kit", "kits",
  "collection", "new", "sale", "buy", "shop", "store", "default", "bundle", "combo", "value", "size", "sizes",
  "item", "items", "product", "products", "edp", "edt", "edc", "ml", "oz", "gm", "gr", "free", "gift",
  "offer", "offers", "deal", "deals",
]);

/** True when a label is meaningless as a user-facing decision option. */
export function isJunkLabel(label) {
  const s = String(label == null ? "" : label).trim().toLowerCase();
  if (s.length < 3) return true;                       // "de", single chars, 2-letter fragments
  if (/^[\d.,]+$/.test(s)) return true;                // a bare number
  if (/^[\d.,]+\s*(ml|oz|gm|gr|g|kg|l)$/.test(s)) return true; // a bare unit/size
  if (JUNK.has(s)) return true;                        // function word / packaging boilerplate
  return false;
}

/** Keep only options whose label is a meaningful attribute (drops junk). */
export function meaningfulOptions(values) {
  return (values || []).filter((v) => !isJunkLabel(v && (v.label != null ? v.label : v.value)));
}

export default { isJunkLabel, meaningfulOptions };
