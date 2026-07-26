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

export function scoreAgainstGold(gold, recommend, opts = {}) {
  const baselineUnserved = opts.baselineUnserved ?? 9; // old-brain baseline unserved count
  const droppedAxes = opts.droppedAxes || [];          // G4 records: [{axis, gate, evidence}] justifying extra unserved
  const ft = new Map((gold.family_decision_truth || []).map(f => [f.family, f]));
  const skusByFamily = new Map();
  const priceBy = new Map();
  for (const s of gold.sku_offer_truth || []) {
    if (!skusByFamily.has(s.family)) skusByFamily.set(s.family, []);
    skusByFamily.get(s.family).push(s.sku);
    priceBy.set(s.sku, s.price);
  }
  const ceiling = (gold.band_boundaries && gold.band_boundaries.ceiling_price) || { 0: 458.5, 1: 945, 2: Infinity };
  const canElicit = typeof recommend.canElicit === "function" ? recommend.canElicit : () => true;
  const cats = { exact_fulfillment: 0, honest_no_match: 0, disclosed_compromise: 0, silent_compromise: 0, hard_violation: 0, false_no_match: 0 };
  let unserved = 0; const unservedList = [];
  const detail = [];
  for (const it of gold.intents || []) {
    const c = it.constraints;
    const accepted = new Set(it.accepted_skus || []);
    const rec = recommend(c) || { no_match: true };
    // anti-axis-starvation guard: can the funnel even ELICIT this intent's constraints?
    const served = canElicit(c);
    if (!served) { const missing = canElicit({ ...c, origin: "any" }) ? "origin" : "format/budget"; unserved++; unservedList.push({ id: it.id, missing_axis: missing }); }
    let cat;
    const exp = Array.isArray(it.expected) ? it.expected : [it.expected]; // expected is a SET (closure #6)
    if (rec.no_match || !rec.family) {
      cat = exp.includes("HONEST_NO_MATCH") ? "honest_no_match" : "false_no_match";
    } else {
      const fam = ft.get(rec.family) || {};
      const offeredSku = (skusByFamily.get(rec.family) || [])[0]; // old brain offers variant[0]
      const price = priceBy.get(offeredSku);
      const overBudget = price != null && price > (ceiling[c.budget_ceiling] ?? Infinity);
      const wrongFormat = fam.format !== c.format; // bundle/mixed/other ≠ requested single format
      if (wrongFormat || overBudget) cat = "hard_violation";           // ق8 (format eligibility / budget ceiling) — even if disclosed
      else if (offeredSku && accepted.has(offeredSku)) cat = "exact_fulfillment";
      else {
        // DISCLOSED_COMPROMISE succeeds ONLY if ALL three hold (closure — not merely "disclosed"):
        // (1) all hard constraints fully met — already true here (not wrongFormat/overBudget);
        // (2) deviation confined to the intent's named SOFT axis (unsatisfiable_constraint, role=*soft*);
        // (3) disclosure is STRUCTURED {fulfilled, unfulfilled, unknown}, not prose, and unfulfilled ⊆ {that soft axis}.
        const soft = /soft/i.test(it.constraint_role || "");
        const d = rec.disclosure;
        const structured = !!d && Array.isArray(d.fulfilled) && Array.isArray(d.unfulfilled) && Array.isArray(d.unknown);
        const confined = structured && d.unfulfilled.length > 0 && d.unfulfilled.every((ax) => ax === it.unsatisfiable_constraint);
        cat = (soft && structured && confined) ? "disclosed_compromise" : "silent_compromise";
      }
    }
    // an UNSERVED intent can never be credited as exact_fulfillment (the funnel didn't elicit the
    // constraint — any match is luck, not fulfillment). Downgrade to silent_compromise.
    if (!served && cat === "exact_fulfillment") cat = "silent_compromise";
    cats[cat]++;
    detail.push({ id: it.id, expected: it.expected, family: rec.family || null, cat, served });
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
    unserved_intent_rate: r(unserved), // 6th REPORTED number (not a gate) — anti-axis-starvation
  };
  // ---- acceptance gates, computed on SERVED intents (an unserveable constraint has no category) ----
  const servedN = N - unserved;
  const exactCeiling = (gold.intents || []).filter((it) => (Array.isArray(it.expected) ? it.expected : [it.expected]).includes("EXACT")).length; // 11
  const exactExpectedUnserved = (gold.intents || []).filter((it) => (Array.isArray(it.expected) ? it.expected : [it.expected]).includes("EXACT") && !canElicit(it.constraints)).length;
  const gates = {
    served: servedN,
    // hard/silent are ZERO over ALL 27 (an unserved path does not excuse betrayal) — ق8/ق9
    hard_zero: cats.hard_violation === 0,
    silent_zero: cats.silent_compromise === 0,
    // exact reaches the gold ceiling; all achievable matches lie inside served (proof: none unserved)
    exact_ceiling: exactCeiling,
    exact_meets_ceiling: cats.exact_fulfillment === exactCeiling,
    no_exact_in_unserved: exactExpectedUnserved === 0,
    // identity over SERVED, not 27
    identity_served: (cats.exact_fulfillment + cats.honest_no_match + cats.disclosed_compromise) === servedN,
    // axis-starvation is BLOCKING: extra unserved beyond baseline needs a G4 record
    unserved_within_baseline: unserved <= baselineUnserved || droppedAxes.length > 0,
    false_no_match_zero: cats.false_no_match === 0,
  };
  gates.pass = gates.hard_zero && gates.silent_zero && gates.exact_meets_ceiling && gates.no_exact_in_unserved && gates.identity_served && gates.unserved_within_baseline && gates.false_no_match_zero;
  const identityHolds = gates.identity_served && gates.silent_zero && gates.hard_zero && gates.false_no_match_zero;
  return { N, cats, rates, identityHolds, gates, detail, unserved, unservedList };
}

/** OLD-brain adapter: intent constraints -> {family, relaxedAxes} via the current authorFunnel table.
 *  Carries `.canElicit` so the scorer can flag intents whose constraint the funnel can't even ask. */
export function oldBrainAdapter(config, products) {
  const familyOfUrl = (u) => String(u || "").split("/products/")[1] || u;
  const archFamily = new Map((config.archetypes || []).map(a => [a.id, familyOfUrl(a.recommendations && a.recommendations.primary && a.recommendations.primary.url)]));
  const facetDomain = new Set((config.decisionTable || []).map(r => r.when && r.when.D_facet5).filter(Boolean));
  const rec = (c) => {
    const facet = facetDomain.has(c.origin) ? c.origin : [...facetDomain][0]; // unexpressible origin → brain can't ask
    const rule = (config.decisionTable || []).find(r => r.when && r.when.D_format === c.format && String(r.when.D_budget) === String(c.budget_ceiling) && r.when.D_facet5 === facet);
    if (!rule || rule.kind === "TERMINAL") return { no_match: true };
    const fam = archFamily.get(rule.result);
    if (!fam) return { no_match: true };
    return { family: fam, relaxedAxes: (rule.relaxed || []).map((x) => x.axis) };
  };
  // format + budget are always askable; origin is elicitable ONLY for values in the funnel's taste axis.
  rec.canElicit = (c) => c.origin === "any" || facetDomain.has(c.origin);
  return rec;
}
