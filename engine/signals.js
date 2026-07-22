/**
 * engine/signals.js — Signal derivation (STEP 4), generic + config-driven.
 *
 * Sits between raw answers and the (Step-7) decision resolver, turning the raw
 * signals a funnel collects into its derived decision signals. The DERIVATION
 * LOGIC lives in the config (`derivedSignals`) as DATA, not in this file — so the
 * engine is funnel-agnostic and a new funnel needs NO engine edit.
 *
 * derivedSignals rules:
 *   { id, rule:"identity", from:[rawId] }                      passthrough
 *   { id, rule:"cases", from:[rawIds],                         first-match → value
 *         cases:[{ when:{rawId: val|[vals]}, value }],
 *         default, domain:[...],
 *         clamp:[{ when, ifValue, to }] }                      coherence override
 *
 * `when`/`clamp.when` predicates use the same value/array/wildcard semantics as
 * the decision table. Non-decision signals (presentation/offer) pass through with
 * their declared default. Pure + deterministic; no DOM/storage coupling.
 *
 * Canonical value vocab below is OPTIONAL convenience for config authoring/tests;
 * configs may use string literals directly. It is no funnel's source of truth.
 */

/* ------------------------- optional value vocab (PM-era; not engine logic) -- */
export const QUAL = { DIPLOMA: "diploma", BACHELOR: "bachelor_plus" };
export const HOURS = { LT_4500: "lt_4500", GE_4500_LT_7500: "ge_4500_lt_7500", GE_7500: "ge_7500", UNSURE: "unsure" };
export const ENV = { PRIVATE: "private", GOVERNMENT: "government", CONSTRUCTION: "construction", NOT_YET: "not_yet_working" };
export const CRED = { NONE: "none", CAPM: "capm", PRINCE2_FOUNDATION: "prince2_foundation", PMP_PLUS: "pmp_plus", OTHER_NON_PM: "other_non_pm" };
export const THRESHOLD = { MEETS: "meets", BELOW: "below", UNSURE: "unsure" };
export const TIER = { NONE: "none", ENTRY: "entry_level", PMP_PLUS: "pmp_plus" };

/* ------------------------------------------------------------------ engine -- */

/** Predicate matcher (same semantics as decide.matchRule; local to avoid an
 *  import cycle with decide.js). value = equality · array = membership · {} = any. */
function predicate(values, when) {
  for (const [k, exp] of Object.entries(when || {})) {
    const v = values[k];
    if (Array.isArray(exp)) { if (!exp.includes(v)) return false; }
    else if (v !== exp) return false;
  }
  return true;
}

/** Apply one derivedSignal spec to raw values. @returns {{value, clamped}} */
export function applyDerivation(spec, raw) {
  if (spec.rule === "identity") return { value: raw[spec.from[0]], clamped: false };
  if (spec.rule === "cases") {
    let value = spec.default;
    for (const c of spec.cases || []) if (predicate(raw, c.when)) { value = c.value; break; }
    let clamped = false;
    for (const cl of spec.clamp || []) if (value === cl.ifValue && predicate(raw, cl.when)) { value = cl.to; clamped = true; }
    return { value, clamped };
  }
  throw new Error(`signals: unknown derivation rule "${spec.rule}"`);
}

/**
 * Derive all signals from raw values, driven entirely by config.derivedSignals.
 * @returns derived decision signals + passed-through presentation/offer signals + meta.
 */
export function deriveSignals(config = {}, raw = {}) {
  const out = {};
  const meta = { clamped: false, clamps: [] };
  for (const spec of config.derivedSignals || []) {
    const { value, clamped } = applyDerivation(spec, raw);
    out[spec.id] = value;
    if (clamped) { meta.clamped = true; meta.clamps.push(spec.id); }
  }
  for (const s of config.signals || []) {
    if (s.role && s.role !== "decision") out[s.id] = raw[s.id] ?? s.default ?? null;
  }
  out.meta = meta;
  return out;
}

/**
 * Collect raw signal values out of engine answers ({questionId:optionId}) using
 * the funnel's config.signals bindings (source + option→value map). Unmapped/
 * absent answers fall back to the signal's `default`.
 */
export function collectRawSignals(answers = {}, config = {}) {
  const raw = {};
  for (const sig of config.signals || []) {
    const optionId = answers[sig.source];
    const mapped =
      optionId != null && sig.map && sig.map[optionId] != null ? sig.map[optionId] : sig.default;
    raw[sig.id] = mapped;
  }
  return raw;
}

export default { deriveSignals, collectRawSignals, applyDerivation };
