/**
 * tests/lib/evalScorer.mjs — INDEPENDENT scorer for the frozen evaluation corpus (Part 2).
 * ---------------------------------------------------------------------------------------------
 * The four numbers the acceptance rule binds to. Classification is derived from the RAW catalog
 * (NOT matcher flags — ق22 independence): a returned product is judged EXACT / hard_violation /
 * silent_compromise by re-deriving its format (name/type keywords), price band (self-computed
 * tertiles), and origin (raw token). The SAME function scores the OLD and NEW brain — only the
 * `recommend(intent)` adapter differs.
 *
 * Anti-gaming (constitution + operator arbitration): the denominator is the FIXED corpus length
 * (never filtered); NO_MATCH counts as honest_no_match ONLY when ground-truth is empty; a returned
 * product that fails a choice can NEVER be scored EXACT. Pure, deterministic.
 */

// independent raw-data derivations
export function makeDerivers(products) {
  const prices = products.map(p => p.price).filter(n => typeof n === "number").sort((a, b) => a - b);
  const t1 = prices[Math.floor(prices.length / 3)], t2 = prices[Math.floor(2 * prices.length / 3)];
  const txt = (p) => `${p.name} ${(p.differentiators || []).join(" ")} ${(p.attributes && p.attributes.type) || ""}`.toLowerCase();
  return {
    t1, t2,
    band: (p) => p.price == null ? null : (p.price <= t1 ? 0 : p.price >= t2 ? 2 : 1),
    fmt: (p) => { const t = txt(p);
      if (/\b(oil|dahn|دهن|زيت|attar|مخلط)\b/.test(t)) return "oil";
      if (/\b(bakhoor|بخور|wood|chips|agarwood|tola|muattar|معطر)\b/.test(t)) return "raw";
      if (/\b(perfume|parfum|eau|spray|بخاخ|extrait|edp|edt|fragrance)\b/.test(t)) return "perfume";
      return "unknown"; },
    hasOrigin: (p, o) => o === "any" ? true : new RegExp(`\\b${o}\\b`, "i").test(txt(p)),
  };
}

/**
 * @param {object} args
 * @param {Array}  args.corpus     frozen intents [{format, budget_ceiling, origin}]
 * @param {Array}  args.products   raw catalog
 * @param {(intent)=>({product?:object, no_match?:boolean})} args.recommend  brain adapter
 * @returns {{rates:object, cats:object, N:number, detail:Array}}
 */
export function scoreCorpus({ corpus, products, recommend }) {
  const d = makeDerivers(products);
  const gt = (it) => products.filter(p => d.fmt(p) === it.format && d.band(p) != null && d.band(p) <= it.budget_ceiling && d.hasOrigin(p, it.origin));
  const cats = { exact_fulfillment: 0, honest_no_match: 0, silent_compromise: 0, hard_violation: 0, false_no_match: 0 };
  const detail = [];
  for (const it of corpus) {
    const g = gt(it).length;
    const rec = recommend(it) || { no_match: true };
    let cat;
    if (rec.no_match || !rec.product) cat = g ? "false_no_match" : "honest_no_match";
    else {
      const P = rec.product;
      if (d.fmt(P) !== it.format) cat = "hard_violation";
      else if (d.band(P) > it.budget_ceiling) cat = "hard_violation";
      else if (it.origin !== "any" && !d.hasOrigin(P, it.origin)) cat = "silent_compromise";
      else cat = "exact_fulfillment";
    }
    cats[cat]++;
    detail.push({ it, gt: g, product: rec.product && rec.product.name, cat });
  }
  const N = corpus.length;
  const rate = (n) => n / N;
  return {
    N, cats, detail,
    rates: {
      exact_fulfillment_rate: rate(cats.exact_fulfillment),
      honest_no_match_rate: rate(cats.honest_no_match),
      silent_compromise_rate: rate(cats.silent_compromise),
      hard_violation_rate: rate(cats.hard_violation),
      false_no_match_rate: rate(cats.false_no_match),
    },
  };
}

/** OLD-brain adapter: map an intent onto the current authorFunnel decisionTable. */
export function oldBrainAdapter(config, products) {
  const byUrl = new Map(products.map(p => [p.url, p]));
  const archPrimary = new Map((config.archetypes || []).map(a => [a.id, a.recommendations && a.recommendations.primary && a.recommendations.primary.url]));
  const facetDomain = new Set((config.decisionTable || []).map(r => r.when && r.when.D_facet5).filter(Boolean));
  return (it) => {
    const facet = facetDomain.has(it.origin) ? it.origin : [...facetDomain][0]; // unexpressible origin → brain can't ask
    const rule = (config.decisionTable || []).find(r => r.when && r.when.D_format === it.format && String(r.when.D_budget) === String(it.budget_ceiling) && r.when.D_facet5 === facet);
    if (!rule || rule.kind === "TERMINAL") return { no_match: true };
    return { product: byUrl.get(archPrimary.get(rule.result)) || null };
  };
}
