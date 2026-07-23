/**
 * platform/review/reviewModel.js — Pure model for the Studio review screen (ADR-0023).
 * ---------------------------------------------------------------------------
 * Given a generation result (config + both gate results + optional catalog/meta),
 * produce everything the review screen renders: whether it's publishable, the
 * per-gate evidence (with findings), plain-language blockers, and a human summary
 * (what it asks, what it recommends). Pure — no DOM, no network — so it is fully
 * unit-tested and the HTML page is a thin renderer over it.
 */

const GATE_LABELS = {
  trust: "بوابة الثقة (لا نتائج مسدودة)",
  bland: "بوابة الجودة (لا رتابة)",
};

function _findings(g) {
  return (g && Array.isArray(g.findings)) ? g.findings : [];
}

function _gateCard(id, gate) {
  const findings = _findings(gate);
  const ok = !!(gate && gate.ok);
  return {
    id,
    label: GATE_LABELS[id] || id,
    ok,
    findingCount: findings.length,
    findings,
    summary: ok ? "اجتازت ✓" : (findings.length ? `${findings.length} ملاحظة تمنع النشر` : "لم تجتَز"),
  };
}

function _primaryNames(config) {
  const out = [];
  for (const a of (config.archetypes || [])) {
    const p = a && a.recommendations && a.recommendations.primary;
    if (p && p.name && !out.includes(p.name)) out.push(p.name);
  }
  return out;
}

/**
 * @param {{config:Object, trust:Object, bland:Object, catalog?:Object, meta?:Object}} res
 */
export function buildReviewModel(res = {}) {
  const config = res.config || null;
  const gates = [_gateCard("trust", res.trust), _gateCard("bland", res.bland)];

  const blockers = [];
  if (!config) blockers.push("لم يتم إنشاء فانل بعد.");
  for (const g of gates) if (!g.ok) blockers.push(`${g.label}: ${g.summary}`);

  const ok = !!config && gates.every((g) => g.ok);

  let summary = null;
  if (config) {
    const products = _primaryNames(config);
    const questions = config.questions || [];
    summary = {
      brand: (config.brand && config.brand.name) || "",
      theme: config.theme || "",
      lang: config.lang || "ar",
      questionCount: questions.length,
      resultCount: (config.archetypes || []).length,
      productCount: res.catalog && Array.isArray(res.catalog.products) ? res.catalog.products.length : products.length,
      firstQuestion: questions[0] ? questions[0].text : "",
      recommends: products,
    };
  }

  return { ok, status: ok ? "ready" : "blocked", gates, blockers, summary };
}
