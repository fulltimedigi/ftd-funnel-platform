/**
 * engine/kernel/grounding.js — per unit × claim grounding (ADR-0037 closing, BLOCKER-2).
 * ===========================================================================================
 * The kernel treats an ungrounded value as UNKNOWN. This module decides, for one product and one
 * axis value, WHETHER that value is grounded and by WHAT provenance — so "grounded" is earned from
 * real evidence, never assumed. `compileUnits` no longer stamps grounded:true blindly.
 *
 * Provenance order (only the top tiers count as "known" for a hard constraint):
 *   1. STRUCTURED  — a structured product field carries it (attributes.type, price).
 *   2. MERCHANT    — a merchant-declared tag / differentiator carries it.
 *   3. ONTOLOGY    — a deterministic ontology over authoritative store text (format regex, tiers).
 *   4. EXTRACTION  — a validated extraction from the product NAME, negation/qualifier-aware.
 *   5. INFERENCE   — uncorroborated inference → NOT grounded (UNKNOWN).
 * A bare token match is NOT proof on its own — an EXTRACTION claim is rejected when a negation or
 * "free-of" qualifier sits next to the token. One ungrounded product never demotes the whole axis:
 * only THAT product's claim is UNKNOWN.
 *
 * Each claim carries: { grounded, status, source_type, evidence, extractor_version, catalog_version }.
 * Pure, deterministic, dependency-free (imports only the format ontology).
 */

import { productFormat } from "../../authoring/author/formatAxis.js";

export const EXTRACTOR_VERSION = "ground-1";

export const SOURCE = { STRUCTURED: "structured", MERCHANT: "merchant", ONTOLOGY: "ontology", EXTRACTION: "extraction", INFERENCE: "inference", NONE: "none" };

const lc = (s) => String(s == null ? "" : s).toLowerCase();
const NEG = /(بدون|بدون\s|خالٍ?\s*من|خالي\s*من|غير|no\s|without\s|free[\s-]?of|[a-z]-free)/i;

/** Is `value` negated/qualified-away next to its mention in `text`? (token ≠ proof) */
function negatedNear(text, value) {
  const t = lc(text), v = lc(value);
  const i = t.indexOf(v);
  if (i < 0) return false;
  const window = t.slice(Math.max(0, i - 18), i + v.length + 8);
  return NEG.test(window);
}

/**
 * @param {Object} product   the real product
 * @param {string} axisId    axis id
 * @param {*} value          the axis value being claimed for this product
 * @param {Object} meta       { kind: 'format'|'budget'|'soft', catalogVersion }
 * @returns {{grounded, status, source_type, evidence, extractor_version, catalog_version}}
 */
export function groundClaim(product, axisId, value, meta = {}) {
  const out = (grounded, source_type, evidence) => ({ grounded, status: grounded ? "grounded" : "unknown", source_type, evidence: evidence || null, extractor_version: EXTRACTOR_VERSION, catalog_version: meta.catalogVersion || null });
  const kind = meta.kind || "soft";
  const val = lc(value);

  // budget / price — a real numeric price is a structured fact.
  if (kind === "budget") {
    return product.price != null && Number.isFinite(Number(product.price))
      ? out(true, SOURCE.STRUCTURED, `price=${product.price}`)
      : out(false, SOURCE.NONE, "no price");
  }

  // 1. STRUCTURED field
  const type = lc(product.attributes && product.attributes.type);
  if (type && (type === val || type.includes(val) || val.includes(type))) return out(true, SOURCE.STRUCTURED, `attributes.type=${type}`);

  // 2. MERCHANT-declared tag / differentiator
  const diffs = (product.differentiators || []).map(lc);
  const tags = (product.tags || []).map(lc);
  if (diffs.includes(val) || tags.includes(val)) return out(true, SOURCE.MERCHANT, "differentiator/tag");

  // 3. ONTOLOGY — format has a deterministic ontology over title + type + tags.
  if (kind === "format") {
    const f = productFormat(product);
    if (f != null && lc(f) === val) return out(true, SOURCE.ONTOLOGY, `productFormat=${f}`);
    return out(false, SOURCE.NONE, "format not deterministically resolvable");
  }

  // 4. EXTRACTION from the NAME — validated, negation/qualifier-aware.
  const name = lc(product.name);
  if (val && name.includes(val)) {
    if (negatedNear(product.name, value)) return out(false, SOURCE.INFERENCE, "token present but negated/qualified");
    return out(true, SOURCE.EXTRACTION, "name token (validated)");
  }

  // 4b. VALIDATED EXTERNAL MAPPING (SOFT axes only): a domain-expert model's per-product value,
  //     already validated against the real catalog (real url + in-domain), is a grounding tier
  //     ABOVE uncorroborated inference. It grounds a SOFT axis (always disclosed on mismatch) but
  //     NEVER a hard one — so an inferred value can never become a hard filter.
  if (kind === "soft" && meta.provenance === "ai-validated") return out(true, SOURCE.MERCHANT, "expert mapping validated to the catalog");

  // 5. otherwise uncorroborated → UNKNOWN.
  return out(false, SOURCE.INFERENCE, "uncorroborated");
}

/** Classify an authored axis into a grounding kind. */
export function axisKind(axis) {
  if (axis.hard && axis.ordinal) return "budget";
  if (axis.hard) return "format";
  return "soft";
}

export default { groundClaim, axisKind, SOURCE, EXTRACTOR_VERSION };
