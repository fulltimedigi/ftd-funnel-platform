/**
 * engine/recommend.js — Explanation Layer (STEP 8).
 *
 * Responsibility (§5, §6, §9 + Standard Rules 9/10/11):
 *   For the resolved archetype, build the recommendation the user sees:
 *     1. the recommendation (cert + price + url)
 *     2. WHY it fits        — reasons, each gated by the signal it claims
 *     3. WHY NOT the alternatives — rejected options, each gated likewise
 *     4. what happens next  — the concrete action
 *   and resolve every `becauseTemplate` into a concrete `because`.
 *
 * HARD RULE (§9): no recommendation renders without a resolved `because`.
 *   If the headline because can't resolve, the recommendation is suppressed.
 *
 * DEFENSIBILITY (Rule 11): every why/why-not bullet carries a `needs` predicate.
 *   It is rendered ONLY if the user's derived signals satisfy it — reusing the
 *   decision engine's matchRule. The engine therefore cannot show a claim the
 *   user's signals don't support. There is no free-text path around this.
 *
 * Dual-mode results (R1/R2 entry-tier, R6 context) are handled by `variants`:
 *   the first variant whose `needs` matches overrides the base recommendation.
 */

import { matchRule } from "./decide.js";

const TOKEN = /\{(\w+)\}/g;

/**
 * Replace {token}s from `context`. Returns the resolved string, or null if ANY
 * token is unresolved (caller treats null as "suppress" per the HARD RULE).
 * A template with no tokens always resolves to itself.
 */
export function resolveTemplate(template, context = {}) {
  if (typeof template !== "string") return null;
  let ok = true;
  const out = template.replace(TOKEN, (_, key) => {
    const v = context[key];
    if (v == null || v === "") {
      ok = false;
      return "";
    }
    return String(v);
  });
  return ok ? out : null;
}

/** Context available to templates: the derived signal values. */
function buildContext(scoring) {
  return { ...(scoring?.signals || {}) };
}

/** First variant whose `needs` the signals satisfy (or null). */
function selectVariant(extras, signals) {
  for (const v of extras?.variants || []) {
    if (matchRule(signals, v.needs || {})) return v;
  }
  return null;
}

/** Render a bullet list, dropping any bullet the signals don't support. */
function renderBullets(list, signals, context) {
  const out = [];
  for (const b of list || []) {
    if (!matchRule(signals, b.needs || {})) continue; // Rule 11 gate
    const text = resolveTemplate(b.claim, context);
    if (!text) continue;
    out.push(b.name ? { name: b.name, text } : { text });
  }
  return out;
}

/**
 * Build the ordered recommendations for a resolved archetype.
 * @returns {{ primary:?object, contextual:object[], ruleId:?string }}
 */
export function buildRecommendations(resolved, scoring, config) {
  const ruleId = scoring?.ruleId ?? null;
  const arch = resolved?.primary;
  if (!arch) return { primary: null, contextual: [], ruleId };

  const signals = scoring?.signals || {};
  const context = buildContext(scoring);
  const extras = arch.resultExtras || {};
  const base = (arch.recommendations && arch.recommendations.primary) || {};
  const variant = selectVariant(extras, signals);
  const rec = { ...base, ...(variant || {}) };

  const because = resolveTemplate(rec.becauseTemplate, context);
  if (!because) {
    console.warn(`recommend: suppressed "${arch.id}" — becauseTemplate did not resolve (HARD RULE §9)`);
    return { primary: null, contextual: [], ruleId };
  }

  const primary = {
    ...rec,
    because,
    why: renderBullets(extras.why, signals, context),
    whyNot: renderBullets(extras.whyNot, signals, context),
    nextAction: (variant && variant.nextAction) || extras.nextAction || null,
  };

  const contextual = [];
  for (const c of (arch.recommendations && arch.recommendations.contextual) || []) {
    if (!matchRule(signals, c.needs || {})) continue;
    const cb = resolveTemplate(c.becauseTemplate, context);
    if (!cb) continue; // a contextual rec is still a rec — no because, no render
    contextual.push({ ...c, because: cb });
  }

  return { primary, contextual, ruleId };
}

export default { buildRecommendations, resolveTemplate };
