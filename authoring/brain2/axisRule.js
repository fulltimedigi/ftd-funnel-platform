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

// v4 — "expected-residual reduction, integer, guarded" (consultation round-4). Fixes the v3 COLLAPSE: on a
// uniform partition v3's `N − Σsᵢ²/S` (N = max bucket) is 0 for BOTH an ideal even split AND a single-value
// axis, so the alphabetical tie-break picked the useless axis. v4 restores the correct baseline:
//
//   reduction(axis) = S − (Σsᵢ² + u₀²)/S
//
// where S = the NODE's exact-pool size |E| (a NODE property — identical for every candidate axis at the
// node), sᵢ = per-option EXACT count, and u₀ = S − Σsᵢ is the EXPLICIT unknown-on-axis residual bucket
// (ungrounded values are never `exact`, so they leave every sᵢ and land here; policy.unknown_axis_handling).
// The buckets {sᵢ} ∪ {u₀} PARTITION the node's exact pool, so Σsᵢ + u₀ = S exactly (asserted).
//
// Justification (record this, NOT "Gini"): Σsᵢ²/S = Σ(sᵢ/S)·sᵢ is literally the EXPECTED size of the pool
// that REMAINS after the shopper answers — maximizing the reduction shrinks the candidate pool as fast as
// possible, which is the actual goal (reach a leaf under the cap). Because S is node-constant, ranking axes
// by max reduction == ranking by MIN of the integer `Σsᵢ² + u₀²` — no division, no float, no log
// (determinism + hash safety). Guards are counts-only; tie-break never starts from the axis id.
export const AXIS_RULE_ID_V4 = "max-info-gain@v4";

/** lower-median of an integer array (deterministic, no float average). */
function lowerMedian(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
}

/**
 * v4. @param {{[axisId:string]: {sizes:number[], evidence:number}}} axisStats — per-option EXACT sizes +
 *   the axis EVIDENCE degree (grounding-coverage count; counts only, no identities).
 * @param {{S:number, minExactRatio?:number, mirrorDensityMax?:number}} cfg — S = node exact-pool size |E|
 *   (identical for every axis at this node). Returns the chosen axisId or null (a leaf / no valid axis).
 */
export function diagnoseAxesV4(axisStats = {}, { S, minExactRatio = 0.5, mirrorDensityMax = 0.5 } = {}) {
  const rejected = []; // { ax, reason } — for reporting (e.g. "which axes did the mirror guard drop, by name")
  if (!Number.isInteger(S) || S <= 0) return { chosen: null, ranked: [], rejected };
  const survivors = [];
  for (const [ax, stat] of Object.entries(axisStats)) {
    const sizes = (stat && stat.sizes) || [];
    const k = sizes.length;
    if (!k) { rejected.push({ ax, reason: "no-options" }); continue; }
    const sumS = sizes.reduce((a, b) => a + b, 0);
    const u0 = S - sumS;
    if (u0 < 0) throw new Error(`diagnoseAxesV4: Σsᵢ (${sumS}) > S (${S}) on axis "${ax}" — an exact unit counted in >1 option (multi-membership) is unsupported by the partition model; define the axis single-valued or extend the model`);
    const penalized = sizes.reduce((a, b) => a + b * b, 0) + u0 * u0; // Σsᵢ² + u₀² (integer)
    // guard 1 — reduction > 0 STRICTLY: reduction>0 ⟺ S² > penalized. Kills a no-split (single-value) axis.
    if (S * S - penalized <= 0) { rejected.push({ ax, reason: "no-split" }); continue; }
    // guard 2 — MIRROR (a per-option-identifier axis scores the MAX reduction, so info-gain can't gate it):
    //   reject if the median option holds a single item, OR options are too dense over the exact pool.
    if (lowerMedian(sizes) === 1) { rejected.push({ ax, reason: "mirror:median-1" }); continue; }
    if (sumS > 0 && k / sumS > mirrorDensityMax) { rejected.push({ ax, reason: `mirror:density ${k}/${sumS}>${mirrorDensityMax}` }); continue; }
    // guard 3 — the existing mostly-compromise gate (fraction of options with exact>0 below the floor).
    const ratio = sizes.filter((n) => n > 0).length / k;
    if (ratio < minExactRatio) { rejected.push({ ax, reason: `mostly-compromise ${ratio.toFixed(2)}<${minExactRatio}` }); continue; }
    survivors.push({ ax, penalized, k, maxSize: Math.max(...sizes), evidence: Number(stat.evidence) || 0 });
  }
  // Rank: MIN penalized (= max reduction) → tie-break: fewer options → smaller max bucket → higher evidence
  // → canonical axis id (LAST resort, never removed — determinism). The id is never the FIRST criterion.
  survivors.sort((a, b) =>
    (a.penalized - b.penalized) ||
    (a.k - b.k) ||
    (a.maxSize - b.maxSize) ||
    (b.evidence - a.evidence) ||
    (a.ax < b.ax ? -1 : a.ax > b.ax ? 1 : 0));
  return { chosen: survivors.length ? survivors[0].ax : null, ranked: survivors, rejected };
}

/**
 * v4 — the pure chooser (used by the builder AND re-run by the verifier). Delegates to diagnoseAxesV4 so
 * guard logic lives in ONE place. Returns the chosen axisId or null (a leaf / no valid axis).
 */
export function chooseAxisByInfoGainV4(axisStats = {}, cfg = {}) { return diagnoseAxesV4(axisStats, cfg).chosen; }

// v5 — same expected-residual SCORE as v4, but (consultation round-5): (1) the partition invariant
// Σsᵢ + u₀ = S is asserted per axis (else the cross-axis denominator differs and the comparison is
// undefined); (2) the MIRROR guard is PER-OPTION not distributional — reject when the SINGLETON SHARE
// (options of size 1 / Σsᵢ) exceeds mirror_singleton_share_max, because a minority of singletons planted
// among legitimate buckets (median & density both innocent) still reveals those items individually; and
// (3) the guard is NOT applied when S ≤ exemptBound (an honest final binary on a tiny pool must not be
// rejected). The v4 median/density criteria are retired. The u₀-REACHABILITY invariant is enforced
// server-side (oracle.verifyReachability) because the counts-only brain cannot see an axis's relax mode.
export const AXIS_RULE_ID_V5 = "max-info-gain@v5";

export function diagnoseAxesV5(axisStats = {}, { S, minExactRatio = 0.5, mirrorSingletonShareMax = 0.2, exemptBound = 1 } = {}) {
  const rejected = [];
  if (!Number.isInteger(S) || S <= 0) return { chosen: null, ranked: [], rejected };
  const survivors = [];
  for (const [ax, stat] of Object.entries(axisStats)) {
    const sizes = (stat && stat.sizes) || [];
    const k = sizes.length;
    if (!k) { rejected.push({ ax, reason: "no-options" }); continue; }
    const sumS = sizes.reduce((a, b) => a + b, 0);
    const u0 = S - sumS;
    // (1) PARTITION invariant: the buckets {sᵢ} ∪ {u₀} must partition the node's exact pool exactly.
    if (u0 < 0) throw new Error(`diagnoseAxesV5: partition invariant Σsᵢ+u₀=S broken on axis "${ax}" — Σsᵢ (${sumS}) > S (${S}); an exact unit counted in >1 option (multi-membership) makes the cross-axis denominator undefined`);
    const penalized = sizes.reduce((a, b) => a + b * b, 0) + u0 * u0;
    if (S * S - penalized <= 0) { rejected.push({ ax, reason: "no-split" }); continue; } // reduction>0 strictly
    // (3) MIRROR (per-option): exempt tiny pools; else reject on singleton share over the exact pool.
    if (S > exemptBound) {
      const singletonShare = sumS > 0 ? sizes.filter((n) => n === 1).length / sumS : 0;
      if (singletonShare > mirrorSingletonShareMax) { rejected.push({ ax, reason: `mirror:singleton-share ${singletonShare.toFixed(3)}>${mirrorSingletonShareMax}` }); continue; }
    }
    const ratio = sizes.filter((n) => n > 0).length / k;
    if (ratio < minExactRatio) { rejected.push({ ax, reason: `mostly-compromise ${ratio.toFixed(2)}<${minExactRatio}` }); continue; }
    survivors.push({ ax, penalized, k, maxSize: Math.max(...sizes), evidence: Number(stat.evidence) || 0 });
  }
  survivors.sort((a, b) =>
    (a.penalized - b.penalized) || (a.k - b.k) || (a.maxSize - b.maxSize) || (b.evidence - a.evidence) || (a.ax < b.ax ? -1 : a.ax > b.ax ? 1 : 0));
  return { chosen: survivors.length ? survivors[0].ax : null, ranked: survivors, rejected };
}

/** v5 — the pure chooser (used by the builder AND re-run by the verifier). */
export function chooseAxisByInfoGainV5(axisStats = {}, cfg = {}) { return diagnoseAxesV5(axisStats, cfg).chosen; }

// v6 — same expected-residual SCORE; the MIRROR guard is now DERIVED in the score's own currency
// (consultation round-6), replacing the free-floating v5 singleton-share (which was blind to all-size-2
// distributions). A mirror = "each answer leaves ≈ one candidate", i.e. a small EXPECTED RESIDUAL POOL SIZE.
//   metric = Σsᵢ²/S  (the score's residual, option buckets only). Reject for branching when metric < CAP.
// Implemented as the integer comparison Σsᵢ² < CAP·S (no float). Exempt when S ≤ CAP (the whole pool already
// fits one display grid, so any split is at worst redundant, never a mirror).
//   CAP anchor: the operator's command said leaf_primary_cap, but leaf_primary_cap=1 makes the criterion
//   INERT (Σsᵢ²/S ≥ 1 always) — it rejects nothing and fails the operator's own "all-size-2 ⇒ reject" test.
//   leaf_total_cap is the anchor that satisfies all three stated tests and matches the concept (a mirror
//   leaves fewer than a grid's worth per answer). Surfaced in policy._mirror_metric_note; confirm.
// NOTE (denominator, per the operator's "justify the denominator" rule): S includes the u₀ unknowns, so a
// SPARSE-but-legitimate soft axis (large u₀) is flagged as a mirror by Σsᵢ²/S though its options do not
// fragment (Σsᵢ²/Σsᵢ would clear it). This is a KNOWN false-positive of the literal /S spec — surfaced, not
// silently switched. Every mirror rejection is reported (rejected[]) as an axis GATE-FAILURE signal.
export const AXIS_RULE_ID_V6 = "max-info-gain@v6";

export function diagnoseAxesV6(axisStats = {}, { S, minExactRatio = 0.5, leafTotalCap = 4 } = {}) {
  const rejected = [];
  if (!Number.isInteger(S) || S <= 0) return { chosen: null, ranked: [], rejected };
  const survivors = [];
  for (const [ax, stat] of Object.entries(axisStats)) {
    const sizes = (stat && stat.sizes) || [];
    const k = sizes.length;
    if (!k) { rejected.push({ ax, reason: "no-options" }); continue; }
    const sumS = sizes.reduce((a, b) => a + b, 0);
    const u0 = S - sumS;
    if (u0 < 0) throw new Error(`diagnoseAxesV6: partition invariant Σsᵢ+u₀=S broken on axis "${ax}" — Σsᵢ (${sumS}) > S (${S})`);
    const sumSq = sizes.reduce((a, b) => a + b * b, 0);
    const penalized = sumSq + u0 * u0;
    if (S * S - penalized <= 0) { rejected.push({ ax, reason: "no-split" }); continue; } // reduction>0 strictly
    // MIRROR (derived): expected residual Σsᵢ²/S < leafTotalCap ⟺ Σsᵢ² < leafTotalCap·S. Exempt when S ≤ cap.
    if (S > leafTotalCap && sumSq < leafTotalCap * S) { rejected.push({ ax, reason: `mirror:residual ${(sumSq / S).toFixed(2)}<${leafTotalCap}` }); continue; }
    const ratio = sizes.filter((n) => n > 0).length / k;
    if (ratio < minExactRatio) { rejected.push({ ax, reason: `mostly-compromise ${ratio.toFixed(2)}<${minExactRatio}` }); continue; }
    survivors.push({ ax, penalized, k, maxSize: Math.max(...sizes), evidence: Number(stat.evidence) || 0 });
  }
  survivors.sort((a, b) =>
    (a.penalized - b.penalized) || (a.k - b.k) || (a.maxSize - b.maxSize) || (b.evidence - a.evidence) || (a.ax < b.ax ? -1 : a.ax > b.ax ? 1 : 0));
  return { chosen: survivors.length ? survivors[0].ax : null, ranked: survivors, rejected };
}

/** v6 — the pure chooser (builder + verifier). */
export function chooseAxisByInfoGainV6(axisStats = {}, cfg = {}) { return diagnoseAxesV6(axisStats, cfg).chosen; }

export default { chooseAxis, AXIS_RULE_ID, chooseAxisByInfoGain, AXIS_RULE_ID_V2, chooseAxisByInfoGainV3, AXIS_RULE_ID_V3, chooseAxisByInfoGainV4, AXIS_RULE_ID_V4, diagnoseAxesV4, chooseAxisByInfoGainV5, AXIS_RULE_ID_V5, diagnoseAxesV5, chooseAxisByInfoGainV6, AXIS_RULE_ID_V6, diagnoseAxesV6 };
