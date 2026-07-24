/**
 * authoring/quality/depthCalibration.js — calibrate funnel DEPTH to catalog density (ADR-0037
 * depth phase). The bug: authoring maximised depth/coverage and over-asked taste axes the catalog
 * couldn't support exactly, so most paths ended in a forced COMPROMISE (low exact-path-rate). The
 * kernel was right; the AUTHORING was too deep.
 *
 * This module scores gate-passing candidates and picks the DEEPEST MEANINGFUL funnel whose
 * exact-path-rate ≥ T (an authoring target, NOT a correctness gate). If none reaches T, it picks the
 * best HONEST funnel (highest exact-path-rate) and records the conflict — it never games the ratio
 * by dropping useful paths, hiding COMPROMISE, or making eligible SKUs unreachable.
 *
 *   exact-path-rate = EXACT reachable paths ÷ total reachable paths   (numerator + denominator both kept)
 *
 * Pure, deterministic. Reads only the materialized config (proofs) + the catalog.
 */

import { productFormat } from "../author/formatAxis.js";
import { priceCutpoints as _pc, cleanPrice, tierOf } from "../author/budgetAxis.js";

export const EXACT_PATH_TARGET = 0.6;

/**
 * differentiatingDensity(catalog) — the count of DISTINCT grounded, canonicalized product profiles
 * (ADR-0037 richness redefinition). "Rich" = enough trustworthy DIFFERENTIATING data, not product
 * count. A profile is the tuple of a product's GROUNDED, canonical values on the axes a funnel can
 * actually decide on:
 *   • structured type (attributes.type), merchant differentiators/tags, and the deterministic form
 *     ontology — all grounded; UNKNOWN/missing contributes nothing.
 *   • PRICE as a BAND (tertile cutpoints), never the raw number — 43 distinct prices must NOT look
 *     like 43 distinct profiles.
 *   • identity/high-cardinality fields (url, title/name, SEO tags) are EXCLUDED.
 * Two products with the same type + band + differentiators are ONE profile — they support one taste
 * combination, not many. Deterministic, pure.
 */
export function differentiatingDensity(catalog) {
  const products = (catalog && catalog.products) || (Array.isArray(catalog) ? catalog : []);
  const cuts = _pc(products); // catalog-wide tertile bands (not per-product raw price)
  const sigs = new Set();
  for (const p of products) {
    const parts = [];
    const type = String((p.attributes && p.attributes.type) || "").trim().toLowerCase();
    if (type) parts.push("t:" + type);
    const form = productFormat(p); if (form) parts.push("f:" + String(form).toLowerCase());
    const band = cuts ? tierOf(cleanPrice(p), cuts) : null; if (band != null) parts.push("b:" + band);
    for (const d of (p.differentiators || [])) { const v = String(d).trim().toLowerCase(); if (v) parts.push("d:" + v); }
    for (const g of (p.tags || [])) { const v = String(g).trim().toLowerCase(); if (v) parts.push("g:" + v); }
    parts.sort();
    if (parts.length) sigs.add(parts.join("|")); // an all-UNKNOWN product adds no differentiating profile
  }
  return sigs.size;
}

/** exact-path-rate with its numerator and denominator (never just the ratio). */
export function exactPathStats(config) {
  const rules = (config.decisionTable || []).filter((r) => r.when && Object.keys(r.when).length);
  const exactPaths = rules.filter((r) => r.proof && r.proof.match_state === "EXACT").length;
  const reachablePaths = rules.length;
  return { exactPaths, reachablePaths, rate: reachablePaths ? exactPaths / reachablePaths : 0 };
}

/** Distinct SKUs surfaced (primary OR alternate) — the surfaced-coverage count. */
export function surfacedCoverage(config) {
  const s = new Set();
  for (const a of config.archetypes || []) { if (a.recommendations && a.recommendations.primary) s.add(a.recommendations.primary.url); for (const c of (a.recommendations && a.recommendations.contextual) || []) s.add(c.url); }
  return s.size;
}

/** Taste (non-hard) axis ids of a config = decision axes that aren't in the constraint ladder. */
export function tasteAxisIds(config) {
  const hard = new Set(config.constraintLadder || []);
  return (config.signals || []).map((s) => s.id.replace(/^s_/, "")).filter((id) => !hard.has(id));
}

/**
 * A retained taste axis is MEANINGFUL iff it actually changes the recommendation on ≥1 reachable
 * path: two rules that differ ONLY in that axis's value resolve to different archetypes. A taste
 * axis that never flips the result is a mirror/decorative question — not meaningful.
 */
export function meaningfulTasteAxes(config) {
  const rules = (config.decisionTable || []).filter((r) => r.when && Object.keys(r.when).length);
  const byKey = new Map(rules.map((r) => [JSON.stringify(r.when), r.result]));
  const out = new Set();
  for (const id of tasteAxisIds(config)) {
    const D = `D_${id}`;
    for (const r of rules) {
      const others = { ...r.when };
      const mine = others[D];
      delete others[D];
      // find a sibling rule identical except this axis, with a different result
      for (const sib of rules) {
        if (sib === r || sib.when[D] === mine) continue;
        const so = { ...sib.when }; delete so[D];
        if (JSON.stringify(so) === JSON.stringify(others) && sib.result !== r.result) { out.add(id); break; }
      }
      if (out.has(id)) break;
    }
  }
  return out;
}

/**
 * The MEANING GUARD: a calibrated funnel must keep the catalog's hard promises (format and/or
 * budget — whichever the catalog actually supports) PLUS ≥1 MEANINGFUL taste axis (≥2 supported
 * values — true by construction since dead options are pruned — that changes ≥1 reachable result).
 * A catalog with no "format" (e.g. laptops) is not forced to invent one; the guard only requires
 * ≥1 real hard axis and ≥1 meaningful taste axis, so the funnel is never a bare 2 hard questions.
 */
export function meetsMeaningGuard(config) {
  const hard = (config.constraintLadder || []).length;
  const hasHard = hard >= 1 || (config.constraintPolicy || []).some((c) => c.mode === "NEVER_RELAX" || c.type === "ordinal");
  const meaningful = meaningfulTasteAxes(config);
  return hasHard && meaningful.size >= 1;
}

function score(config, catalog) {
  const stats = exactPathStats(config);
  const products = ((catalog && catalog.products) || []).length || 1;
  return {
    config,
    rate: stats.rate,
    exactPaths: stats.exactPaths,
    reachablePaths: stats.reachablePaths,
    coverage: surfacedCoverage(config),
    coverageRatio: surfacedCoverage(config) / products,
    depth: (config.signals || []).length,
    meaningful: meetsMeaningGuard(config),
  };
}

/** A candidate is FEASIBLE iff it passes the meaning guard AND exact-path-rate ≥ T AND coverage floor. */
export function isFeasible(config, catalog, T = EXACT_PATH_TARGET, minCoverage = 0.9) {
  const s = score(config, catalog);
  return s.meaningful && s.rate >= T - 1e-9 && s.coverageRatio >= minCoverage - 1e-9;
}

/**
 * Pick the calibrated funnel from gate-passing candidates (ADR-0037).
 * Feasible = meaning guard + exact-path-rate ≥ T + surfaced coverage ≥ floor. Among feasible pick the
 * DEEPEST (tie → rate, then coverage). If none feasible, the best HONEST funnel (highest rate, then
 * coverage, then depth). Also reports `deeperFeasibleExists` — whether a feasible candidate DEEPER
 * than the pick exists — which richnessCheck uses to decide thinness (there never is, by construction,
 * so the pick always passes the THIN check: the gate agrees with the calibration, never fights it).
 * @returns {{ chosen, targetMet, scored, limiting, deeperFeasibleExists }}
 */
export function pickCalibrated(candidates, catalog, T = EXACT_PATH_TARGET, minCoverage = 0.9) {
  const scored = candidates.map((c) => score(c.config, catalog));
  const meaningful = scored.filter((s) => s.meaningful);
  const pool = meaningful.length ? meaningful : scored; // guard: prefer meaningful; fall back if none

  const feasible = pool.filter((s) => s.rate >= T - 1e-9 && s.coverageRatio >= minCoverage - 1e-9);
  let chosen, targetMet;
  if (feasible.length) {
    // FEASIBLE (≥ target): a rich catalog earns depth — pick the DEEPEST, then rate, then coverage.
    feasible.sort((a, b) => b.depth - a.depth || b.rate - a.rate || b.coverage - a.coverage);
    chosen = feasible[0]; targetMet = true;
  } else {
    // DENSITY-CAPPED (nothing meets the target): deepening can't improve the promise, so the honest
    // best is the LEANEST funnel at the highest rate — highest rate, then coverage, then FEWER questions.
    pool.sort((a, b) => b.rate - a.rate || b.coverage - a.coverage || a.depth - b.depth);
    chosen = pool[0]; targetMet = false;
  }
  const deeperFeasibleExists = feasible.some((s) => s.depth > chosen.depth); // deeper AND feasible than the pick
  const limiting = targetMet ? null : `catalog density: best honest exact-path-rate ${chosen.exactPaths}/${chosen.reachablePaths} (${(chosen.rate * 100).toFixed(0)}%) < target ${(T * 100).toFixed(0)}% — no deeper funnel stays ≥ target on this catalog`;
  return { chosen, targetMet, scored, limiting, deeperFeasibleExists };
}

export default { EXACT_PATH_TARGET, exactPathStats, surfacedCoverage, tasteAxisIds, meaningfulTasteAxes, meetsMeaningGuard, pickCalibrated };
