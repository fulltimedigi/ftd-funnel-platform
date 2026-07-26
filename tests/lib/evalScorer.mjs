/**
 * tests/lib/evalScorer.mjs — GOLD-BASED scorer for the Part-2 brain (closures #4 + #5).
 * ---------------------------------------------------------------------------------------------
 * Truth comes from a human-reviewable GOLD SET (tests/fixtures/gold-set.json), NOT the scorer's own
 * heuristics (ق22): per intent it holds accepted_skus + expected (EXACT | HONEST_NO_MATCH), and a
 * catalog_attributes table (format/band/origin) for classifying a returned product. The scorer only
 * COMPARES — it never re-infers semantics.
 *
 * Five categories (closure #4). Identity for a VALID build: exact_fulfillment + honest_no_match +
 * disclosed_compromise = 100%, with silent_compromise = 0 AND hard_violation = 0 (ق8/ق9). A
 * disclosed concession is legitimate (ق9); the SILENT one is the betrayal. Denominator is the FIXED
 * gold intent set (never filtered — closure #3). Pure, deterministic.
 */

/**
 * @param {object} gold  parsed gold-set.json
 * @param {(constraints)=>({sku?:string, no_match?:boolean, relaxedAxes?:string[]})} recommend  brain adapter
 * @returns {{N, cats, rates, identityHolds, detail}}
 */
export function scoreAgainstGold(gold, recommend) {
  const attrBy = new Map((gold.catalog_attributes || []).map(a => [a.sku, a]));
  const cats = { exact_fulfillment: 0, honest_no_match: 0, disclosed_compromise: 0, silent_compromise: 0, hard_violation: 0, false_no_match: 0 };
  const detail = [];
  for (const it of gold.intents || []) {
    const c = it.constraints;
    const accepted = new Set(it.accepted_skus || []);
    const rec = recommend(c) || { no_match: true };
    let cat;
    if (rec.no_match || !rec.sku) {
      cat = it.expected === "HONEST_NO_MATCH" ? "honest_no_match" : "false_no_match";
    } else {
      const a = attrBy.get(rec.sku) || {};
      const hard = a.format !== c.format || (a.band != null && a.band > c.budget_ceiling);
      if (hard) cat = "hard_violation";
      else if (accepted.has(rec.sku)) cat = "exact_fulfillment";
      else cat = (rec.relaxedAxes && rec.relaxedAxes.length) ? "disclosed_compromise" : "silent_compromise";
    }
    cats[cat]++;
    detail.push({ id: it.id, expected: it.expected, sku: rec.sku || null, cat });
  }
  const N = (gold.intents || []).length;
  const r = (n) => (N ? n / N : 0);
  const rates = {
    exact_fulfillment_rate: r(cats.exact_fulfillment),
    honest_no_match_rate: r(cats.honest_no_match),
    disclosed_compromise_rate: r(cats.disclosed_compromise),
    silent_compromise_rate: r(cats.silent_compromise),
    hard_violation_rate: r(cats.hard_violation),
    false_no_match_rate: r(cats.false_no_match),
  };
  const identityHolds = (cats.exact_fulfillment + cats.honest_no_match + cats.disclosed_compromise) === N
    && cats.silent_compromise === 0 && cats.hard_violation === 0 && cats.false_no_match === 0;
  return { N, cats, rates, identityHolds, detail };
}

/** OLD-brain adapter: intent constraints -> {sku, relaxedAxes} via the current authorFunnel table. */
export function oldBrainAdapter(config, products) {
  const byUrl = new Map(products.map(p => [p.url, p]));
  const archPrimary = new Map((config.archetypes || []).map(a => [a.id, a.recommendations && a.recommendations.primary && a.recommendations.primary.url]));
  const facetDomain = new Set((config.decisionTable || []).map(r => r.when && r.when.D_facet5).filter(Boolean));
  return (c) => {
    const facet = facetDomain.has(c.origin) ? c.origin : [...facetDomain][0]; // unexpressible origin → brain can't ask
    const rule = (config.decisionTable || []).find(r => r.when && r.when.D_format === c.format && String(r.when.D_budget) === String(c.budget_ceiling) && r.when.D_facet5 === facet);
    if (!rule || rule.kind === "TERMINAL") return { no_match: true };
    const url = archPrimary.get(rule.result);
    if (!url || !byUrl.get(url)) return { no_match: true };
    return { sku: url, relaxedAxes: (rule.relaxed || []).map((x) => x.axis) };
  };
}
