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

// v7 — the mirror guard is reduced to the ONE infallible counts-only bound (consultation round-6→7). Mirror
// is a SEMANTIC property (are the axis values product identities?) the counts-only brain cannot see, so any
// numeric threshold is either over-aggressive or blind. The only case counts can decide WITHOUT error is the
// DECISIVE mirror: every published option isolates a single item (max sᵢ < 2) ⇒ a disguised grid — showing
// the grid is always more honest, at any S (so there is NO small-pool exemption). Everything softer (a
// MINORITY of singletons) is a REPORTED signal (mirror_singleton_share, measured on GROUNDED options only —
// an unknown is not a revealing option), escalated to the authoring gates where the values ARE visible.
//
// TWO DENOMINATORS, kept distinct (each stated: what it measures · its denominator · why that denominator):
//   • RANKING residual = (Σsᵢ² + u₀²)/S — "how much pool is expected to remain?"; the unknown IS a real
//     residual bucket, so it belongs in the numerator and the denominator is the whole node pool S. (v5 form.)
//   • MIRROR signal = (#singleton options)/Σsᵢ — "do the PUBLISHED options isolate individuals?"; an unknown
//     is not a published, identity-revealing option, so the denominator is the GROUNDED pool Σsᵢ, not S.
// v6's Σsᵢ²/S<leaf_total_cap guard was doubly broken (hybrid denominator underscored sparse-grounding axes;
// threshold contradicted leaf_primary_cap; size-weighted ⇒ blind to a minority mirror) — corrected here.
export const AXIS_RULE_ID_V7 = "max-info-gain@v7";

export function diagnoseAxesV7(axisStats = {}, { S, minExactRatio = 0.5 } = {}) {
  const rejected = [], signals = [];
  if (!Number.isInteger(S) || S <= 0) return { chosen: null, ranked: [], rejected, signals };
  const survivors = [];
  for (const [ax, stat] of Object.entries(axisStats)) {
    const sizes = (stat && stat.sizes) || [];
    const k = sizes.length;
    if (!k) { rejected.push({ ax, reason: "no-options" }); continue; }
    const sumS = sizes.reduce((a, b) => a + b, 0);
    const u0 = S - sumS;
    if (u0 < 0) throw new Error(`diagnoseAxesV7: partition invariant Σsᵢ+u₀=S broken on axis "${ax}" — Σsᵢ (${sumS}) > S (${S})`);
    const penalized = sizes.reduce((a, b) => a + b * b, 0) + u0 * u0; // RANKING residual (Σsᵢ²+u₀²)/S
    if (S * S - penalized <= 0) { rejected.push({ ax, reason: "no-split" }); continue; } // reduction>0 strictly
    // DECISIVE mirror bound (no free number, no exemption): reject only when NO option isolates >1 item.
    if (Math.max(...sizes) < 2) { rejected.push({ ax, reason: "mirror:all-singleton (disguised grid)" }); continue; }
    const ratio = sizes.filter((n) => n > 0).length / k;
    if (ratio < minExactRatio) { rejected.push({ ax, reason: `mostly-compromise ${ratio.toFixed(2)}<${minExactRatio}` }); continue; }
    // REPORTED (not a gate): minority-mirror signal, measured on the GROUNDED pool only.
    const mirror_singleton_share = sumS > 0 ? Number((sizes.filter((n) => n === 1).length / sumS).toFixed(3)) : 0;
    signals.push({ ax, mirror_singleton_share });
    survivors.push({ ax, penalized, k, maxSize: Math.max(...sizes), evidence: Number(stat.evidence) || 0, mirror_singleton_share });
  }
  survivors.sort((a, b) =>
    (a.penalized - b.penalized) || (a.k - b.k) || (a.maxSize - b.maxSize) || (b.evidence - a.evidence) || (a.ax < b.ax ? -1 : a.ax > b.ax ? 1 : 0));
  return { chosen: survivors.length ? survivors[0].ax : null, ranked: survivors, rejected, signals };
}

/** v7 — the pure chooser (builder + verifier). */
export function chooseAxisByInfoGainV7(axisStats = {}, cfg = {}) { return diagnoseAxesV7(axisStats, cfg).chosen; }

// v8 — mirror is BEHAVIORAL (one question that isolates candidates by itself), judged in layers, each in its
// right place (consultation round-8). The counts-only brain keeps only the two error-free counting bounds and
// the corrected signal; the semantic relations move to the authoring gates (authoringGates.js) where values
// are visible. Changes vs v7:
//   • OPTIONS CAP (the bound v7 was missing): a question with more published options than one display can hold
//     is unusable regardless of mirror classification ⇒ not branched (routed to a ق20 display-mode decision).
//     Threshold derived from the display contract (policy.max_published_options_per_question), not a free
//     number. THIS is what actually stops a wide-catalog mirror the decisive bound lets through.
//   • MIRROR SHARE corrected: measured over VALUE-CONFIRMING options only (u₀ AND any "don't care" option are
//     excluded — they confirm no value), so a big don't-care bucket cannot mask a mirror. Ranking keeps both.
//   • Decisive bound kept as-is (no option ≥2 ⇒ reject): zero false positives, but LARGE false negatives on
//     wide catalogs — hence the options cap + authoring gates are the real defense (recorded in the ADR).
export const AXIS_RULE_ID_V8 = "max-info-gain@v8";

export function diagnoseAxesV8(axisStats = {}, { S, minExactRatio = 0.5, maxOptions = null } = {}) {
  const rejected = [], signals = [];
  if (!Number.isInteger(S) || S <= 0) return { chosen: null, ranked: [], rejected, signals };
  const survivors = [];
  for (const [ax, stat] of Object.entries(axisStats)) {
    const sizes = (stat && stat.sizes) || [];
    const confirms = (stat && stat.confirms) || sizes.map(() => true); // default: every option confirms a value
    const k = sizes.length;
    if (!k) { rejected.push({ ax, reason: "no-options" }); continue; }
    const sumS = sizes.reduce((a, b) => a + b, 0);
    const u0 = S - sumS;
    if (u0 < 0) throw new Error(`diagnoseAxesV8: partition invariant Σsᵢ+u₀=S broken on axis "${ax}" — Σsᵢ (${sumS}) > S (${S})`);
    const penalized = sizes.reduce((a, b) => a + b * b, 0) + u0 * u0; // RANKING: all options + u₀ are real buckets
    if (S * S - penalized <= 0) { rejected.push({ ax, reason: "no-split" }); continue; } // reduction>0 strictly
    // OPTIONS CAP (derived, the missing bound): too many options to show in one question ⇒ not a branch.
    if (Number.isInteger(maxOptions) && k > maxOptions) { rejected.push({ ax, reason: `options-cap ${k}>${maxOptions} (route to ق20 display mode, not a branch)` }); continue; }
    // DECISIVE mirror bound (zero false positives; large false negatives — see ADR). No option isolates >1.
    if (Math.max(...sizes) < 2) { rejected.push({ ax, reason: "mirror:all-singleton (disguised grid)" }); continue; }
    const ratio = sizes.filter((n) => n > 0).length / k;
    if (ratio < minExactRatio) { rejected.push({ ax, reason: `mostly-compromise ${ratio.toFixed(2)}<${minExactRatio}` }); continue; }
    // MIRROR SIGNAL (reported) — over VALUE-CONFIRMING options only (excludes u₀ AND "don't care"): a big
    // don't-care bucket must NOT dilute the share and mask a mirror in the remaining options.
    let confDenom = 0, confSingletons = 0;
    for (let i = 0; i < k; i++) { if (!confirms[i]) continue; confDenom += sizes[i]; if (sizes[i] === 1) confSingletons++; }
    const mirror_singleton_share = confDenom > 0 ? Number((confSingletons / confDenom).toFixed(3)) : 0;
    signals.push({ ax, mirror_singleton_share, published_options: k });
    survivors.push({ ax, penalized, k, maxSize: Math.max(...sizes), evidence: Number(stat.evidence) || 0, mirror_singleton_share, published_options: k });
  }
  survivors.sort((a, b) =>
    (a.penalized - b.penalized) || (a.k - b.k) || (a.maxSize - b.maxSize) || (b.evidence - a.evidence) || (a.ax < b.ax ? -1 : a.ax > b.ax ? 1 : 0));
  return { chosen: survivors.length ? survivors[0].ax : null, ranked: survivors, rejected, signals };
}

/** v8 — the pure chooser (builder + verifier). */
export function chooseAxisByInfoGainV8(axisStats = {}, cfg = {}) { return diagnoseAxesV8(axisStats, cfg).chosen; }

// v9 — mirror-vs-grid becomes a DISPLAY-MODE routing, not a rejection (consultation round-9). Rejecting an
// all-singleton or over-cap axis loses legitimate information; a legit unique-per-product axis is a GRID, and
// a product-naming was already rejected upstream at the authoring gates (semantic-type + evidence-basis).
// So the counts-only brain, when it cannot BRANCH an axis for a display reason, ROUTES the node to a ق20
// display mode (per node) instead of rejecting:
//   • options count > display cap ⇒ display mode (too many options for one selector).
//   • all-singleton (max sᵢ < 2)  ⇒ display mode (a grid — every answer isolates one).
// Genuine non-viability (no split; mostly-compromise) stays a `rejected` semantic stop. The ranking is
// unchanged. The mirror share is still reported (value-confirming options only).
export const AXIS_RULE_ID_V9 = "max-info-gain@v9";

export function diagnoseAxesV9(axisStats = {}, { S, minExactRatio = 0.5, maxOptions = null } = {}) {
  const rejected = [], displayMode = [], signals = [];
  if (!Number.isInteger(S) || S <= 0) return { chosen: null, ranked: [], rejected, displayMode, signals };
  const survivors = [];
  for (const [ax, stat] of Object.entries(axisStats)) {
    const sizes = (stat && stat.sizes) || [];
    const confirms = (stat && stat.confirms) || sizes.map(() => true);
    const k = sizes.length;
    if (!k) { rejected.push({ ax, reason: "no-options" }); continue; }
    const sumS = sizes.reduce((a, b) => a + b, 0);
    const u0 = S - sumS;
    if (u0 < 0) throw new Error(`diagnoseAxesV9: partition invariant Σsᵢ+u₀=S broken on axis "${ax}" — Σsᵢ (${sumS}) > S (${S})`);
    const penalized = sizes.reduce((a, b) => a + b * b, 0) + u0 * u0;
    if (S * S - penalized <= 0) { rejected.push({ ax, reason: "no-split" }); continue; } // genuine non-viability
    // OPTIONS CAP → route the NODE to a ق20 display mode (grid/selector), NOT reject (keeps the information).
    if (Number.isInteger(maxOptions) && k > maxOptions) { displayMode.push({ ax, reason: `options-cap ${k}>${maxOptions} → ق20 display mode (selector/grid), not a branch`, mode: "grid" }); continue; }
    // ALL-SINGLETON → display mode (a legit unique-per-product axis is a grid; a naming was rejected upstream).
    if (Math.max(...sizes) < 2) { displayMode.push({ ax, reason: "all-singleton → ق20 display mode (grid), not a branch", mode: "grid" }); continue; }
    const ratio = sizes.filter((n) => n > 0).length / k;
    if (ratio < minExactRatio) { rejected.push({ ax, reason: `mostly-compromise ${ratio.toFixed(2)}<${minExactRatio}` }); continue; }
    let confDenom = 0, confSingletons = 0;
    for (let i = 0; i < k; i++) { if (!confirms[i]) continue; confDenom += sizes[i]; if (sizes[i] === 1) confSingletons++; }
    const mirror_singleton_share = confDenom > 0 ? Number((confSingletons / confDenom).toFixed(3)) : 0;
    signals.push({ ax, mirror_singleton_share, published_options: k });
    survivors.push({ ax, penalized, k, maxSize: Math.max(...sizes), evidence: Number(stat.evidence) || 0, mirror_singleton_share, published_options: k });
  }
  survivors.sort((a, b) =>
    (a.penalized - b.penalized) || (a.k - b.k) || (a.maxSize - b.maxSize) || (b.evidence - a.evidence) || (a.ax < b.ax ? -1 : a.ax > b.ax ? 1 : 0));
  return { chosen: survivors.length ? survivors[0].ax : null, ranked: survivors, rejected, displayMode, signals };
}

/** v9 — the pure chooser (builder + verifier). */
export function chooseAxisByInfoGainV9(axisStats = {}, cfg = {}) { return diagnoseAxesV9(axisStats, cfg).chosen; }

// ===========================================================================================
// v10 — the SEPARATION + FREEZE (consultation round-10). Two things that were entangled in v9 are now
// SEPARATE, because they have different lifecycles:
//   • ACCEPTANCE GATES = SAFETY (correctness). Decide WHAT MAY be chosen. NOT frozen — may be strengthened at
//     any time. `acceptanceGates` below. (partition invariant · reduction>0 · options cap → display mode ·
//     all-singleton → display mode · min_exact_option_ratio. The semantic-type + evidence-basis gates live in
//     authoringGates.js, phase A, where values are visible.)
//   • RANKING RULE = QUALITY. Orders ONLY among the already-accepted axes. FROZEN as `AXIS_SELECTOR_VERSION`.
//     `rankAxesV10` below. Proven QUALITY-not-safety by the control experiment (btree.control-random): under a
//     random accepted-axis choice every PER-NODE safety invariant holds and in_candidate_pool/with_expansion
//     stay 100%. surface_reachable@cap DOES vary with order — but that is a DISPLAY debt (GAP-7 not built),
//     NOT a commitment the ranking carries; the ق2 breach exists in every order. So the freeze is
//     UNCONDITIONAL, and surface_reachable@cap is a REGRESSION baseline, never a reopen threshold (which would
//     pressure tuning the ranking to compensate for a missing display layer). See ADR-0058.
// v10 is BEHAVIORALLY identical to v9 — this is a code/contract separation + a freeze, not a rule change.
export const AXIS_SELECTOR_VERSION = "v10";

/** SAFETY gates — decide which axes are branchable / display-mode / rejected. Counts only. NOT frozen. */
export function acceptanceGates(axisStats = {}, { S, minExactRatio = 0.5, maxOptions = null } = {}) {
  const branchable = [], displayMode = [], rejected = [];
  if (!Number.isInteger(S) || S <= 0) return { branchable, displayMode, rejected };
  for (const [ax, stat] of Object.entries(axisStats)) {
    const sizes = (stat && stat.sizes) || [];
    const confirms = (stat && stat.confirms) || sizes.map(() => true);
    const k = sizes.length;
    if (!k) { rejected.push({ ax, reason: "no-options" }); continue; }
    const sumS = sizes.reduce((a, b) => a + b, 0);
    const u0 = S - sumS;
    if (u0 < 0) throw new Error(`acceptanceGates: partition invariant Σsᵢ+u₀=S broken on "${ax}" — Σsᵢ(${sumS})>S(${S})`);
    const penalized = sizes.reduce((a, b) => a + b * b, 0) + u0 * u0;
    if (S * S - penalized <= 0) { rejected.push({ ax, reason: "no-split" }); continue; }
    if (Number.isInteger(maxOptions) && k > maxOptions) { displayMode.push({ ax, reason: `options-cap ${k}>${maxOptions} → ق20 display mode (selector/grid), not a branch`, mode: "grid" }); continue; }
    if (Math.max(...sizes) < 2) { displayMode.push({ ax, reason: "all-singleton → ق20 display mode (grid), not a branch", mode: "grid" }); continue; }
    const ratio = sizes.filter((n) => n > 0).length / k;
    if (ratio < minExactRatio) { rejected.push({ ax, reason: `mostly-compromise ${ratio.toFixed(2)}<${minExactRatio}` }); continue; }
    let confDenom = 0, confSingletons = 0;
    for (let i = 0; i < k; i++) { if (!confirms[i]) continue; confDenom += sizes[i]; if (sizes[i] === 1) confSingletons++; }
    const mirror_singleton_share = confDenom > 0 ? Number((confSingletons / confDenom).toFixed(3)) : 0;
    branchable.push({ ax, penalized, k, maxSize: Math.max(...sizes), evidence: Number(stat.evidence) || 0, mirror_singleton_share, published_options: k });
  }
  return { branchable, displayMode, rejected };
}

/**
 * QUALITY ranking — FROZEN (AXIS_SELECTOR_VERSION). Orders ONLY the already-accepted axes; carries no safety.
 * Inputs: [{ax, penalized, k, maxSize, evidence}]. Output: the same list sorted.
 * Tie-break: penalized ↑ (min expected residual) → k ↑ (fewer options) → maxSize ↑ (more balanced) →
 * evidence ↓ (better grounded) → axis id ↑ (deterministic last resort). DO NOT edit without a reopen artifact.
 */
export function rankAxesV10(branchable = []) {
  return [...branchable].sort((a, b) =>
    (a.penalized - b.penalized) || (a.k - b.k) || (a.maxSize - b.maxSize) || (b.evidence - a.evidence) || (a.ax < b.ax ? -1 : a.ax > b.ax ? 1 : 0));
}

/** v10 = gates (safety) ∘ frozen ranking (quality). Behaviorally identical to v9. */
export function diagnoseAxesV10(axisStats = {}, cfg = {}) {
  const { branchable, displayMode, rejected } = acceptanceGates(axisStats, cfg);
  const ranked = rankAxesV10(branchable);
  const signals = branchable.map((b) => ({ ax: b.ax, mirror_singleton_share: b.mirror_singleton_share, published_options: b.published_options }));
  return { chosen: ranked.length ? ranked[0].ax : null, ranked, rejected, displayMode, signals };
}

/** v10 — the pure chooser (builder + verifier). */
export function chooseAxisByInfoGainV10(axisStats = {}, cfg = {}) { return diagnoseAxesV10(axisStats, cfg).chosen; }

export default { chooseAxis, AXIS_RULE_ID, chooseAxisByInfoGain, AXIS_RULE_ID_V2, chooseAxisByInfoGainV3, AXIS_RULE_ID_V3, chooseAxisByInfoGainV4, AXIS_RULE_ID_V4, diagnoseAxesV4, chooseAxisByInfoGainV5, AXIS_RULE_ID_V5, diagnoseAxesV5, chooseAxisByInfoGainV6, AXIS_RULE_ID_V6, diagnoseAxesV6, chooseAxisByInfoGainV7, AXIS_RULE_ID_V7, diagnoseAxesV7, chooseAxisByInfoGainV8, AXIS_RULE_ID_V8, diagnoseAxesV8, chooseAxisByInfoGainV9, AXIS_RULE_ID_V9, diagnoseAxesV9, AXIS_SELECTOR_VERSION, acceptanceGates, rankAxesV10, diagnoseAxesV10, chooseAxisByInfoGainV10 };
