/**
 * authoring/quality/richnessCheck.js — the "too thin" gate (ADR-0028, Track A).
 * ---------------------------------------------------------------------------
 * The trust gate catches a DEAD funnel; the anti-bland gate catches a MIRROR
 * funnel; neither catches a THIN one — 2 shallow questions covering 6 of 51
 * products. This gate adds that tooth.
 *
 * Honest by construction: it only fails a thin funnel WHEN THE CATALOG JUSTIFIES
 * MORE. A small catalog that genuinely supports 2 questions passes — we never pad
 * an unjustified question (the anti-bland gate would reject that anyway). So this
 * gate is really the SIGNAL that a rich catalog deserves the AI-enrichment path.
 *
 * "A gate that can't fail is theater": a thin funnel on a rich catalog MUST fail;
 * a rich funnel MUST pass; a thin funnel on a small catalog passes. Pure/Node-safe.
 */

export const RICHNESS_DEFAULTS = {
  richCatalogMin: 12,   // at/above this product count, a catalog can justify depth
  minQuestions: 4,      // a rich catalog deserves ≥ this many question screens
  minCoverage: 0.25,    // …and ≥ this fraction of the catalog reachable as a result
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

/**
 * @param {Object} config   the generated funnel config
 * @param {Object} catalog  { products: [...] } the real ingested catalog
 * @param {Object} [opts]   overrides for RICHNESS_DEFAULTS
 * @returns {{ok:boolean, findings:Array<{code,message}>, metrics:Object}}
 */
export function richnessCheck(config, catalog, opts = {}) {
  const cfg = { ...RICHNESS_DEFAULTS, ...opts };
  const products = (catalog && Array.isArray(catalog.products)) ? catalog.products.length : 0;
  const questions = (config && Array.isArray(config.questions)) ? config.questions.length : 0;
  const reachable = _reachableProductUrls(config || {}).size;
  const coverage = products > 0 ? reachable / products : 0;

  const findings = [];
  const catalogJustifiesDepth = products >= cfg.richCatalogMin;

  if (catalogJustifiesDepth) {
    if (questions < cfg.minQuestions) {
      findings.push({
        code: "RICHNESS_THIN_QUESTIONS",
        message: `Only ${questions} question(s) on a ${products}-product catalog — a catalog this rich justifies ≥ ${cfg.minQuestions}. Escalate to AI enrichment.`,
      });
    }
    if (coverage < cfg.minCoverage) {
      findings.push({
        code: "RICHNESS_LOW_COVERAGE",
        message: `Only ${reachable}/${products} products reachable (${Math.round(coverage * 100)}%) — below the ${Math.round(cfg.minCoverage * 100)}% floor for a catalog this size.`,
      });
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    metrics: { products, questions, reachable, coverage, catalogJustifiesDepth },
  };
}
