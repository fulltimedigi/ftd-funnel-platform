/**
 * authoring/quality/richnessCheck.js — the "too thin" gate (ADR-0028; redefined by ADR-0037).
 * ---------------------------------------------------------------------------
 * The trust gate catches a DEAD funnel; the anti-bland gate catches a MIRROR funnel; neither
 * catches a THIN one — a shallow funnel on a catalog that could support more. This gate adds that
 * tooth.
 *
 * ADR-0037 REDEFINITION (the one authorized gate change): depth is justified by **differentiating
 * density — enough trustworthy, distinct grounded profiles — NOT by raw product count.** A catalog
 * with 43 products but few distinct grounded profiles (e.g. oudfactory) no longer gets force-fed a
 * 4th axis it can't match; a genuinely differentiated catalog with a shallow funnel still FAILS
 * ("a gate that can't fail is theater"). The precise signal is FEASIBILITY: a funnel is thin only
 * if a DEEPER feasible funnel exists (passes the meaning guard AND exact-path-rate ≥ T AND the
 * coverage floor). The authoring pipeline computes that and passes `deeperFeasibleExists`; called
 * standalone, the gate falls back to the density heuristic (`density ≥ richDensityMin`).
 *
 * Pipeline order (ADR-0037, no circularity): generate candidates → exactPathStats + coverage +
 * meaning guard (depthCalibration) → pickCalibrated picks the deepest feasible → richnessCheck only
 * verifies the pick isn't shallower than a deeper FEASIBLE candidate. richnessCheck never rejects
 * candidates by product count before calibration, and never re-selects a funnel on its own.
 *
 * trust / anti-bland are untouched. Pure/Node-safe.
 */

import { differentiatingDensity } from "./depthCalibration.js";

export const RICHNESS_DEFAULTS = {
  richDensityMin: 12,   // ≥ this many DISTINCT GROUNDED PROFILES → the catalog can justify depth
                        // (was `richCatalogMin: 12` raw products — ADR-0037 replaces count with density)
  minQuestions: 4,      // a catalog that justifies depth deserves ≥ this many question screens
  minCoverage: 0.9,     // …and NEAR-FULL surfaced coverage (ADR-0031) — the coverage floor is a hard
                        // tooth: a funnel that orphans most of the catalog is broken and must fail.
};

/** Distinct real product URLs reachable as a recommendation across all archetypes. */
function _reachableProductUrls(config) {
  const urls = new Set();
  for (const a of (config.archetypes || [])) {
    const recs = a.recommendations || {};
    if (recs.primary && recs.primary.url) urls.add(recs.primary.url);
    for (const c of (recs.contextual || [])) if (c && c.url) urls.add(c.url);
  }
  return urls;
}

/** Distinct products that are the #1 (primary) for some answer path — reported, not gated. */
function _primaryProductUrls(config) {
  const urls = new Set();
  for (const a of (config.archetypes || [])) {
    const p = (a.recommendations || {}).primary;
    if (p && p.url) urls.add(p.url);
  }
  return urls;
}

/**
 * @param {Object} config   the generated funnel config
 * @param {Object} catalog  { products: [...] } the real ingested catalog
 * @param {Object} [opts]   overrides + { deeperFeasibleExists?:boolean, density?:number }
 * @returns {{ok:boolean, findings, metrics}}
 */
export function richnessCheck(config, catalog, opts = {}) {
  const cfg = { ...RICHNESS_DEFAULTS, ...opts };
  const products = (catalog && Array.isArray(catalog.products)) ? catalog.products.length : 0;
  const questions = (config && Array.isArray(config.questions)) ? config.questions.length : 0;
  const reachable = _reachableProductUrls(config || {}).size;
  const coverage = products > 0 ? reachable / products : 0;
  const primaries = _primaryProductUrls(config || {}).size;
  const primaryCoverage = products > 0 ? primaries / products : 0;

  // DIFFERENTIATING DENSITY drives depth now (ADR-0037), not product count.
  const density = opts.density != null ? opts.density : differentiatingDensity(catalog || { products: [] });
  const denseCatalog = density >= cfg.richDensityMin; // enough distinct grounded profiles to matter
  // THIN is justified by the precise FEASIBILITY signal from the pipeline (a deeper feasible funnel
  // exists), or — standalone — by the density heuristic. The COVERAGE floor is density-gated (a rich
  // catalog that orphans products fails regardless), so a small/narrow catalog is never force-covered.
  const catalogJustifiesDepth = opts.deeperFeasibleExists != null ? opts.deeperFeasibleExists : denseCatalog;

  const findings = [];
  if (catalogJustifiesDepth && questions < cfg.minQuestions) {
    findings.push({
      code: "RICHNESS_THIN_QUESTIONS",
      message: `Only ${questions} question(s) while a deeper funnel is feasible (differentiating density ${density}) — this catalog justifies ≥ ${cfg.minQuestions}. Escalate depth.`,
    });
  }
  if (denseCatalog && coverage < cfg.minCoverage) {
    findings.push({
      code: "RICHNESS_LOW_COVERAGE",
      message: `Only ${reachable}/${products} products reachable (${Math.round(coverage * 100)}%) — below the ${Math.round(cfg.minCoverage * 100)}% surfaced-coverage floor.`,
    });
  }

  return {
    ok: findings.length === 0,
    findings,
    metrics: { products, questions, reachable, coverage, primaries, primaryCoverage, density, denseCatalog, catalogJustifiesDepth },
  };
}
