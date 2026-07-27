/**
 * platform/review/reviewModel.js — Pure model for the Studio review screen (ADR-0023).
 * ---------------------------------------------------------------------------
 * Given a generation result (config + both gate results + optional catalog/meta),
 * produce everything the review screen renders: whether it's publishable, the
 * per-gate evidence (with findings), plain-language blockers, and a human summary
 * (what it asks, what it recommends). Pure — no DOM, no network — so it is fully
 * unit-tested and the HTML page is a thin renderer over it.
 */

import { respondentStepCount } from "../../engine/flow.js";

const GATE_LABELS = {
  trust: "بوابة الثقة (لا نتائج مسدودة)",
  bland: "بوابة الجودة (لا رتابة)",
  verify: "بوابة البرهان (تغطية إثبات 100٪ — لا نتيجة بلا برهان)",
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

/** Config-only PROOF-COVERAGE signal for the review screen (ADR-0041): every COMMERCE answer-path must
 *  carry a ProvenSelection, else the funnel is not publishable — no result without a proof. This is the
 *  catalog-free view of the publish gate; the authoritative catalog-aware gate (verifyFunnel) runs
 *  server-side in studio.generate/refine. Used only when the caller didn't already pass `res.verify`. */
function _proofCoverage(config) {
  if (!config) return { ok: false, findings: [{ code: "NO_CONFIG" }] };
  const isDecision = config.scoring && config.scoring.mode === "decision-table";
  if (!isDecision) return { ok: true, findings: [] }; // non-decision funnel → no product-proof concept
  const commerce = (config.decisionTable || []).filter((r) => r && r.kind !== "TERMINAL" && r.when && Object.keys(r.when).length);
  const missing = commerce.filter((r) => !(r.proof && r.proof.product_id && r.proof.match_state));
  return { ok: commerce.length === 0 ? true : missing.length === 0, findings: missing.map((r) => ({ code: "NO_PROOF", rule: r.id })) };
}

/**
 * @param {{config:Object, trust:Object, bland:Object, verify?:Object, catalog?:Object, meta?:Object}} res
 */
export function buildReviewModel(res = {}) {
  const config = res.config || null;
  // The publish gate is a THREE-gate conjunction now (ADR-0041): trust + anti-bland + proof coverage.
  // Fail-closed: if the caller didn't pass an authoritative `verify`, derive proof coverage from the
  // config so the review screen can never show "ready" for a funnel that would render a proofless card.
  const verify = res.verify || _proofCoverage(config);
  const gates = [_gateCard("trust", res.trust), _gateCard("bland", res.bland), _gateCard("verify", verify)];

  const blockers = [];
  if (!config) blockers.push("لم يتم إنشاء فانل بعد.");
  for (const g of gates) if (!g.ok) blockers.push(`${g.label}: ${g.summary}`);

  const ok = !!config && gates.every((g) => g.ok);

  let summary = null;
  if (config) {
    const products = _primaryNames(config);
    const questions = config.questions || [];
    const steps = respondentStepCount(config);
    summary = {
      brand: (config.brand && config.brand.name) || "",
      theme: config.theme || "",
      lang: config.lang || "ar",
      questionCount: questions.length,
      resultCount: (config.archetypes || []).length,
      productCount: res.catalog && Array.isArray(res.catalog.products) ? res.catalog.products.length : products.length,
      firstQuestion: questions[0] ? questions[0].text : "",
      recommends: products,
      steps,                              // UX_INTERFACE_DECISION: 3–5 target (incl. email)
      stepsInRange: steps >= 3 && steps <= 5,
      decisiveResult: config.decisiveResult === true,
    };
  }

  return { ok, status: ok ? "ready" : "blocked", gates, blockers, summary };
}
