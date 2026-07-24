/**
 * engine/kernel/certifyForRender.js — the RENDER-TIME reference monitor (ADR-0037 P0; audit round-2
 * "complete mediation"). Findings #1 (warn-not-suppress), #2 (versions never checked at render),
 * #3 (proofless fallback renders), #4 (handoff/safety unwired), #8 (uncertified alternates).
 * ===========================================================================================
 * The bad state — a confident product card + buy CTA without a valid runtime certificate for the
 * EXACT displayed SKU — is made STRUCTURALLY UNREPRESENTABLE. The renderer accepts exactly one of:
 *   • a Symbol-BRANDED CertifiedSelectionResult (minted ONLY here, in-memory), or
 *   • a TerminalOutcome (NO_MATCH | STALE | RESTART_REQUIRED | HANDOFF_UNBOUND | INVALID_ARTIFACT).
 * Both are first-class, MANDATORY render states — never a card plus a ⚠ footnote.
 *
 * The seal is a module-private Symbol (never exported, never serialized). The renderer calls
 * `isCertified()` and refuses to draw a product for anything unbranded. Verification failure returns
 * a terminal, so a proofless `r_default`/`overall` fallback can NEVER render a product card — the
 * forbidden global fallback is closed AT RENDER, regardless of the served table.
 *
 * Mandatory inspection receipts (fail-closed — a missing receipt is a construction error, not a
 * silent pass): proof · versions · presentation (ONE CanonicalOfferRecord) · handoff · safety
 * (PASSED_NOT_APPLICABLE when no safety axis, never "skipped"). This is what WIRES safety.js +
 * handoff.js into production.
 *
 * Pure, deterministic, browser-safe.
 */

import { verifyServedResult } from "./verifyRuntime.js"; // internal-only: called ONLY from here
import { handoffTarget } from "./handoff.js";

// The module-private brand. NOT exported. An object is a real certificate iff it carries this.
const SEAL = Symbol("ftd.CertifiedSelectionResult");

export const TERMINAL_KINDS = ["NO_MATCH", "STALE", "RESTART_REQUIRED", "HANDOFF_UNBOUND", "INVALID_ARTIFACT"];

function terminal(kind, reason) {
  return Object.freeze({ certified: false, terminal: kind, reason: reason || null });
}

/** A CanonicalOfferRecord: every commercial field drawn from ONE product record, with provenance.
 *  No compositing across offers/variants — the SAME record supplies title/image/price/url. */
function canonicalOffer(prod, provenSku) {
  if (!prod || prod.url !== provenSku) return null; // displayed product MUST be the proven SKU
  return Object.freeze({
    product_id: prod.url,
    title: prod.name || "",
    image: prod.image || "",
    price: prod.price != null ? prod.price : (prod.priceText || ""),
    url: prod.url,
    provenance: "proven-sku", // one record, bound to the proven variant
  });
}

/** Certify one alternate independently (audit #8). Returns a branded mini-cert or null (→ removed). */
function certifyAlternate(alt) {
  if (!alt || !alt.proof || !alt.proof.match_state || !alt.proof.product_id) return null;
  if (alt.url !== alt.proof.product_id) return null; // displayed ≠ proven → drop, never composite
  const h = handoffTarget(alt, null);
  if (h.state !== "BOUND") return null; // no deep-linkable SKU → not a renderable alternate
  return Object.freeze({
    [SEAL]: true, certified: true, product_id: alt.url, cta_url: h.url,
    offer: canonicalOffer(alt, alt.proof.product_id),
    match_state: alt.proof.match_state, conflicts: alt.proof.conflicts || [], unknowns: alt.proof.unknowns || [],
  });
}

/**
 * The ONE fail-closed constructor. Returns a branded CertifiedSelectionResult OR a TerminalOutcome.
 * @param {Object} config          the served funnel config
 * @param {Object} resolved        resolver output (scoring.ruleId, primary archetype)
 * @param {Object} answers         the shopper's answers (unused directly; the proof is the authority)
 * @param {Object} [clientVersions] the 5 version stamps the CLIENT loaded — any mismatch → STALE
 */
export function certifyForRender(config, resolved, answers, clientVersions) {
  const scoring = (resolved && resolved.scoring) || {};
  const ruleId = scoring.ruleId;
  // No rule fired (a missing / edited answer left a signal undefined) → honest RESTART, never a product.
  if (!ruleId) return terminal("RESTART_REQUIRED", "no decision rule matched — answer missing or edited");
  const rule = (config.decisionTable || []).find((r) => r.id === ruleId);
  if (!rule) return terminal("INVALID_ARTIFACT", "fired rule not present in the served table");

  // RECEIPT: proof — a renderable product requires a ProvenSelection for THIS path. A proofless
  // fallback rule (the old r_default → overall) has no proof → NO product card (audit #3 closed here).
  const proof = rule.proof;
  if (!proof || !proof.match_state || !proof.product_id) return terminal("NO_MATCH", "no ProvenSelection for this answer-path (proofless fallback refused)");

  // RECEIPT: versions — the STALE/coherence check RUNS at render now (audit #2). Any of the five
  // stamps differing from what the client loaded → STALE, no card.
  const vr = verifyServedResult(config, resolved, clientVersions);
  if (vr.stale) return terminal("STALE", vr.reasons.join("; "));
  if (!vr.ok) return terminal("INVALID_ARTIFACT", "runtime verification failed: " + vr.reasons.join("; "));

  // RECEIPT: presentation — ONE CanonicalOfferRecord, and the displayed product IS the proven SKU.
  const prod = resolved.primary && resolved.primary.recommendations && resolved.primary.recommendations.primary;
  const offer = canonicalOffer(prod, proof.product_id);
  if (!offer) return terminal("INVALID_ARTIFACT", "displayed product is not the proven SKU (composite/route mismatch)");

  // RECEIPT: handoff — CTA = the proven product/variant link, never a parent/brand-home fallback.
  const h = handoffTarget(prod, null);
  if (h.state === "HANDOFF_UNBOUND") return terminal("HANDOFF_UNBOUND", h.reason);

  // RECEIPT: safety — a safety/allergen/compat/legal axis must be SAT; none present → NOT_APPLICABLE
  // (an explicit PASS, never "skipped"). Omission would be a construction error.
  const safetyAxis = (config.constraintPolicy || []).find((c) => c.category);
  let safety = "PASSED_NOT_APPLICABLE";
  if (safetyAxis) {
    const broke = [...(proof.conflicts || []), ...(proof.unknowns || [])].some((x) => x.axis === safetyAxis.id);
    if (broke) return terminal("NO_MATCH", `safety axis ${safetyAxis.id} not satisfied`);
    safety = "PASSED";
  }

  // certify the alternates independently; uncertified ones are removed (never rendered).
  const rawAlts = (resolved.primary.recommendations.contextual || []);
  const alternates = rawAlts.map(certifyAlternate).filter(Boolean);

  // MINT — the only place a CertifiedSelectionResult is born. Frozen + Symbol-branded, in memory.
  return Object.freeze({
    [SEAL]: true,
    certified: true,
    product_id: offer.product_id,
    variant_id: proof.variant_id || null,
    cta_url: h.url, // the CTA target lives INSIDE the certificate; never composed elsewhere
    offer,
    match_state: proof.match_state,
    conflicts: proof.conflicts || [],
    unknowns: proof.unknowns || [],
    alternates,
    catalog_version: config.catalog_version || null,
    policy_version: config.policy_version || null,
    receipts: Object.freeze({ proof: true, versions: true, presentation: true, handoff: true, safety }),
  });
}

/** The renderer's guard: only a Symbol-branded certificate may draw a product card / CTA. */
export function isCertified(obj) {
  return !!(obj && typeof obj === "object" && obj[SEAL] === true);
}

/** True iff the value is a terminal outcome the renderer must draw instead of a product. */
export function isTerminal(obj) {
  return !!(obj && obj.certified === false && TERMINAL_KINDS.includes(obj.terminal));
}

/** The five version stamps a client should echo back (helper for the production entry). */
export function clientVersionsOf(config) {
  return {
    catalog_version: config.catalog_version, policy_version: config.policy_version,
    answer_contract_version: config.answer_contract_version, config_hash: config.config_hash,
    locale_bundle_version: config.locale_bundle_version,
  };
}

export default { certifyForRender, isCertified, isTerminal, clientVersionsOf, TERMINAL_KINDS };
