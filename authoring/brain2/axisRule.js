/**
 * authoring/brain2/axisRule.js — the DECLARED axis-selection rule (round-3, phase B). COUNTS-ONLY.
 * ===========================================================================================
 * A pure function of per-axis OPTION COUNTS — it never sees a candidate identity, a value, or a roster.
 * The rule is announced in advance and the verifier re-runs it over the kernel's counts at each node,
 * asserting the brain chose the SAME axis; any narrowing the counts don't justify = prediction.
 *
 * Rule "most-options-first": pick the unused axis with the MOST qualified options at this node (widest
 * branching), ties broken by axis id (deterministic). No option ⇒ no axis (the node is a leaf).
 */

// v1 — "most-options-first": widest branching. SUPERSEDED (it prefers wide over discriminating). Kept for
// the before/after impact comparison only.
export const AXIS_RULE_ID = "most-options-first@v1";

/** v1. @param {{[axisId:string]: number}} axisOptionCounts — counts ONLY. @returns {string|null}. */
export function chooseAxis(axisOptionCounts = {}) {
  const entries = Object.entries(axisOptionCounts).filter(([, n]) => Number.isInteger(n) && n > 0);
  if (!entries.length) return null;
  entries.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries[0][0];
}

// v2 — "max-info-gain": pick the axis with the greatest EXPECTED REDUCTION in candidate-pool size, computed
// on POOL SIZES ONLY (never identities). reduction(axis) = N − E[residual], E[residual] = Σ sᵢ²/S over the
// per-option eligible sizes sᵢ (S = Σ sᵢ). A soft axis whose options don't shrink the pool scores ~0, so a
// WIDE-but-non-discriminating axis is NOT chosen over a decisive one (the level-3 failure v1 would cause).
// Deterministic tie-break by axis id.
export const AXIS_RULE_ID_V2 = "max-info-gain@v2";

/** v2. @param {{[axisId:string]: number[]}} axisOptionSizes — per-option ELIGIBLE sizes (counts only). */
export function chooseAxisByInfoGain(axisOptionSizes = {}) {
  const scored = [];
  for (const [ax, sizes] of Object.entries(axisOptionSizes)) {
    const s = (sizes || []).filter((n) => Number.isInteger(n) && n >= 0);
    if (!s.length) continue;
    const S = s.reduce((a, b) => a + b, 0);
    if (S <= 0) continue;
    const N = Math.max(...s, S / s.length); // pool scale at this node (upper bound of any single option)
    const residual = s.reduce((a, b) => a + (b * b) / S, 0); // Σ sᵢ²/S
    scored.push([ax, N - residual]);
  }
  if (!scored.length) return null;
  scored.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return scored[0][0];
}

// v3 — "max-info-gain on EXACT, gated" (round-3 full-tree rulings 2+3). A decisive result cares about who
// matches EXACTLY, so the expected reduction is computed on EXACT pool sizes, not eligible. AND a strict
// FILTER runs BEFORE ranking: an axis whose fraction of options with exact≠0 is below `minExactRatio` is a
// mostly-compromise (weakly-grounded) axis — it is rejected FOR BRANCHING (it becomes descriptive, not a
// question), so a soft axis can never be chosen by "reducing" the pool while zeroing exact.
export const AXIS_RULE_ID_V3 = "max-info-gain@v3";

/** v3. @param {{[axisId:string]: {exact:number,eligible:number}[]}} axisOptionStats — counts only. */
export function chooseAxisByInfoGainV3(axisOptionStats = {}, { minExactRatio = 0.5 } = {}) {
  const scored = [];
  for (const [ax, opts] of Object.entries(axisOptionStats)) {
    if (!opts || !opts.length) continue;
    const ratio = opts.filter((o) => o.exact > 0).length / opts.length; // ruling 2: exact-option ratio gate
    if (ratio < minExactRatio) continue; // a mostly-compromise axis does NOT branch
    const sizes = opts.map((o) => o.exact);
    const S = sizes.reduce((a, b) => a + b, 0);
    if (S <= 0) continue;
    const N = Math.max(...sizes);
    const residual = sizes.reduce((a, b) => a + (b * b) / S, 0); // ruling 3: info-gain on EXACT sizes
    scored.push([ax, N - residual]);
  }
  if (!scored.length) return null;
  scored.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return scored[0][0];
}

export default { chooseAxis, AXIS_RULE_ID, chooseAxisByInfoGain, AXIS_RULE_ID_V2, chooseAxisByInfoGainV3, AXIS_RULE_ID_V3 };
