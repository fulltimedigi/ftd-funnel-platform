/**
 * tests/lib/evalScorer.mjs — GOLD-BASED, VARIANT-LEVEL scorer for the Part-2 brain (closures #1-6).
 * ---------------------------------------------------------------------------------------------
 * Truth is the human-reviewable GOLD SET (tests/fixtures/gold-set.json), NOT scorer heuristics (ق22):
 *   • family_decision_truth — format/origin (human sign-off)
 *   • sku_offer_truth       — per-VARIANT price/availability/buy_url (automatic from the Part-1 Ledger)
 *   • intents.accepted_skus — specific VARIANT ids (defect #6: budget judged per offered variant)
 * The brain adapter returns the family it recommends; the scorer resolves the OFFERED variant and
 * compares. Five categories (closure #4); a disclosed concession (ق9) is legitimate, the SILENT one
 * is the betrayal. Denominator = FIXED gold intents (never filtered — closure #3). Pure, deterministic.
 */

export function scoreAgainstGold(gold, recommend) {
  const ft = new Map((gold.family_decision_truth || []).map(f => [f.family, f]));
  const skusByFamily = new Map();
  const priceBy = new Map();
  for (const s of gold.sku_offer_truth || []) {
    if (!skusByFamily.has(s.family)) skusByFamily.set(s.family, []);
    skusByFamily.get(s.family).push(s.sku);
    priceBy.set(s.sku, s.price);
  }
  const ceiling = (gold.band_boundaries && gold.band_boundaries.ceiling_price) || { 0: 458.5, 1: 945, 2: Infinity };
  const cats = { exact_fulfillment: 0, honest_no_match: 0, disclosed_compromise: 0, silent_compromise: 0, hard_violation: 0, false_no_match: 0 };
  const detail = [];
  for (const it of gold.intents || []) {
    const c = it.constraints;
    const accepted = new Set(it.accepted_skus || []);
    const rec = recommend(c) || { no_match: true };
    let cat;
    if (rec.no_match || !rec.family) {
      cat = it.expected === "HONEST_NO_MATCH" ? "honest_no_match" : "false_no_match";
    } else {
      const fam = ft.get(rec.family) || {};
      const offeredSku = (skusByFamily.get(rec.family) || [])[0]; // old brain offers variant[0]
      const price = priceBy.get(offeredSku);
      const overBudget = price != null && price > (ceiling[c.budget_ceiling] ?? Infinity);
      const wrongFormat = fam.format !== c.format; // bundle/mixed/other ≠ requested single format
      if (wrongFormat || overBudget) cat = "hard_violation";           // ق8 (format eligibility / budget ceiling)
      else if (offeredSku && accepted.has(offeredSku)) cat = "exact_fulfillment";
      else cat = (rec.relaxedAxes && rec.relaxedAxes.length) ? "disclosed_compromise" : "silent_compromise";
    }
    cats[cat]++;
    detail.push({ id: it.id, expected: it.expected, family: rec.family || null, cat });
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

/** OLD-brain adapter: intent constraints -> {family, relaxedAxes} via the current authorFunnel table. */
export function oldBrainAdapter(config, products) {
  const familyOfUrl = (u) => String(u || "").split("/products/")[1] || u;
  const archFamily = new Map((config.archetypes || []).map(a => [a.id, familyOfUrl(a.recommendations && a.recommendations.primary && a.recommendations.primary.url)]));
  const facetDomain = new Set((config.decisionTable || []).map(r => r.when && r.when.D_facet5).filter(Boolean));
  return (c) => {
    const facet = facetDomain.has(c.origin) ? c.origin : [...facetDomain][0]; // unexpressible origin → brain can't ask
    const rule = (config.decisionTable || []).find(r => r.when && r.when.D_format === c.format && String(r.when.D_budget) === String(c.budget_ceiling) && r.when.D_facet5 === facet);
    if (!rule || rule.kind === "TERMINAL") return { no_match: true };
    const fam = archFamily.get(rule.result);
    if (!fam) return { no_match: true };
    return { family: fam, relaxedAxes: (rule.relaxed || []).map((x) => x.axis) };
  };
}
