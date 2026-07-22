/**
 * engine/scoring.js — The scoring engine.
 *
 * Responsibility (SPEC §5, §8):
 *   Apply the configured scoring mode across ALL answers and return ONE stable
 *   shape regardless of mode, so the resolver and renderer don't care which ran:
 *
 *     {
 *       primary,    // archetypeId (string) of the top result, or null
 *       secondary,  // archetypeId (string) of the runner-up, or null
 *       scores,     // { archetypeId: number } — full per-archetype map
 *       flags,      // [string] — flags collected from chosen options
 *       sorted      // [[archetypeId, number], ...] — ranked, highest first
 *     }
 *
 * Modes (config.scoring.mode):
 *   - "sum-band"       : each option.score is a NUMBER. Sum them → band lookup.
 *                        scores[arch] = proximity to that archetype's band
 *                        (0 = total falls inside the band; negative = distance
 *                        to the nearest band edge). sorted desc → containing
 *                        band first, nearest adjacent band second.
 *   - "dominant"       : each option.score is { archetypeId: weight }. Accumulate
 *                        per archetype (question weight ignored). Highest wins.
 *   - "weighted-multi" : each option.score is { archetypeId: points }. Accumulate
 *                        points × question.weight. (default / best — FreelanceX)
 *
 * Flags (all per-archetype modes):
 *   An option may carry `flag: "<id>"`. Collected flags are matched against
 *   config.flags definitions ([{ id, adjustments: { archetypeId: +/-points }}])
 *   and applied AFTER accumulation, clamped at 0. (FreelanceX URGENT/AR_ONLY/
 *   EN_GOOD pattern, generalized.) In sum-band there are no per-archetype
 *   accumulators, so flags are collected and returned but not applied to the total.
 *
 * Tie-breaking (within this module, for a deterministic `sorted`):
 *   Equal scores are ordered by the archetype's index in config.archetypes
 *   (earlier = higher). The resolver may apply richer tie-breaking on top.
 *
 * HARD RULE (SPEC §8): every question must affect scoring. That is enforced by
 *   the config-schema validator (no theater), not here — this module simply
 *   processes whatever answers it is given.
 *
 * Inputs:
 *   config  — the funnel config (needs scoring.mode, questions, archetypes, flags).
 *   answers — the user's chosen options, accepted as either:
 *               • an object map { questionId: optionId }, or
 *               • an array of { questionId, optionId } (or { qId, oId }).
 *             Only answered questions need be present (supports branching).
 */

import { scoreDecisionTable } from "./decide.js";

/* ------------------------------------------------------------------ helpers */

/** Normalize answers into an array of { questionId, optionId }. */
function normalizeAnswers(answers) {
  if (!answers) return [];
  if (Array.isArray(answers)) {
    return answers
      .map((a) => ({
        questionId: a.questionId ?? a.qId,
        optionId: a.optionId ?? a.oId,
      }))
      .filter((a) => a.questionId != null && a.optionId != null);
  }
  return Object.entries(answers).map(([questionId, optionId]) => ({
    questionId,
    optionId,
  }));
}

/** Resolve each answer to its { question, option } pair (skips unknowns). */
function resolveChosen(config, answers) {
  const questions = config.questions || [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  const chosen = [];
  for (const { questionId, optionId } of normalizeAnswers(answers)) {
    const question = byId.get(questionId);
    if (!question) continue;
    const option = (question.options || []).find((o) => o.id === optionId);
    if (!option) continue;
    chosen.push({ question, option });
  }
  return chosen;
}

/** Collect distinct flags carried by the chosen options, preserving order. */
function collectFlags(chosen) {
  const seen = new Set();
  const flags = [];
  for (const { option } of chosen) {
    if (option.flag && !seen.has(option.flag)) {
      seen.add(option.flag);
      flags.push(option.flag);
    }
  }
  return flags;
}

/** Apply flag-definition adjustments to a per-archetype score map (clamp ≥ 0). */
function applyFlagAdjustments(scores, flags, config) {
  const definitions = config.flags || [];
  const defById = new Map(definitions.map((d) => [d.id, d]));
  for (const flagId of flags) {
    const def = defById.get(flagId);
    if (!def || !def.adjustments) continue;
    for (const [archId, delta] of Object.entries(def.adjustments)) {
      const next = (scores[archId] || 0) + delta;
      scores[archId] = Math.max(0, next); // clamp at 0
    }
  }
  return scores;
}

/**
 * Sort a per-archetype score map into [[id, score], ...], highest first,
 * breaking ties by archetype declaration order (earlier wins). Optionally
 * drop archetypes scoring ≤ 0.
 */
function sortScores(scores, config, { filterPositive } = {}) {
  const order = new Map((config.archetypes || []).map((a, i) => [a.id, i]));
  const entries = Object.entries(scores).filter(([, v]) =>
    filterPositive ? v > 0 : true
  );
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // score desc
    const ai = order.has(a[0]) ? order.get(a[0]) : Number.MAX_SAFE_INTEGER;
    const bi = order.has(b[0]) ? order.get(b[0]) : Number.MAX_SAFE_INTEGER;
    return ai - bi; // tie-break: declaration order asc
  });
  return entries;
}

/* -------------------------------------------------------------------- modes */

/** Mode 1 — sum-band. */
function scoreSumBand(config, chosen, flags) {
  let total = 0;
  for (const { option } of chosen) {
    total += Number(option.score) || 0;
  }
  // Proximity score per banded archetype: 0 inside band, else -(edge distance).
  const scores = {};
  for (const arch of config.archetypes || []) {
    const band = arch.band;
    if (!band) continue;
    let dist = 0;
    if (total < band.min) dist = band.min - total;
    else if (total > band.max) dist = total - band.max;
    // dist === 0 → inside band; avoid producing -0 (which !== 0 under Object.is).
    scores[arch.id] = dist === 0 ? 0 : -dist;
  }
  const sorted = sortScores(scores, config, { filterPositive: false });
  return {
    primary: sorted[0]?.[0] ?? null,
    secondary: sorted[1]?.[0] ?? null,
    scores,
    flags,
    sorted,
  };
}

/** Modes 2 & 3 — dominant / weighted-multi (accumulate a per-archetype map). */
function scoreAccumulated(config, chosen, flags, { useWeight }) {
  // Initialize every archetype to 0 so the scores map is complete.
  const scores = {};
  for (const arch of config.archetypes || []) scores[arch.id] = 0;

  for (const { question, option } of chosen) {
    const map = option.score;
    if (!map || typeof map !== "object") continue;
    const weight = useWeight ? question.weight ?? 1 : 1;
    for (const [archId, points] of Object.entries(map)) {
      scores[archId] = (scores[archId] || 0) + points * weight;
    }
  }

  applyFlagAdjustments(scores, flags, config);

  const sorted = sortScores(scores, config, { filterPositive: true });
  return {
    primary: sorted[0]?.[0] ?? null,
    secondary: sorted[1]?.[0] ?? null,
    scores,
    flags,
    sorted,
  };
}

/* ------------------------------------------------------------------- public */

/**
 * Score a set of answers against a funnel config.
 * @returns {{primary:?string, secondary:?string, scores:Object, flags:string[], sorted:Array}}
 */
export function score(config, answers) {
  if (!config || !config.scoring || !config.scoring.mode) {
    throw new Error("scoring.score: config.scoring.mode is required");
  }
  const mode = config.scoring.mode;

  // decision-table resolves from derived signals, not from per-option points,
  // so it bypasses the chosen-option accumulation entirely.
  if (mode === "decision-table") {
    return scoreDecisionTable(config, answers);
  }

  const chosen = resolveChosen(config, answers);
  const flags = collectFlags(chosen);

  switch (mode) {
    case "sum-band":
      return scoreSumBand(config, chosen, flags);
    case "dominant":
      return scoreAccumulated(config, chosen, flags, { useWeight: false });
    case "weighted-multi":
      return scoreAccumulated(config, chosen, flags, { useWeight: true });
    default:
      throw new Error(`scoring.score: unknown mode "${mode}"`);
  }
}

export default { score };
