/**
 * engine/resolver.js — Archetype resolver.
 *
 * Responsibility (SPEC §5, §8):
 *   Map the scoring result to archetype object(s) from config.archetypes and
 *   compute a primary/secondary blend proportion for the result UI
 *   ("mostly X, with a streak of Y").
 *
 * Tie-breaking beyond scoring.js's deterministic ordering can be layered here
 *   later; Phase 1 trusts the sorted order scoring already produced.
 *
 * resolve(scoring, config) → { primary, secondary, proportion, scoring }
 */

export function resolve(scoring, config) {
  const byId = new Map((config.archetypes || []).map((a) => [a.id, a]));
  const primary = scoring.primary ? byId.get(scoring.primary) || null : null;
  const secondary = scoring.secondary ? byId.get(scoring.secondary) || null : null;

  const p = primary ? scoring.scores[primary.id] || 0 : 0;
  const s = secondary ? scoring.scores[secondary.id] || 0 : 0;
  const sum = p + s;
  const proportion =
    sum > 0
      ? { primaryPct: Math.round((p / sum) * 100), secondaryPct: Math.round((s / sum) * 100) }
      : { primaryPct: 100, secondaryPct: 0 };

  return { primary, secondary, proportion, scoring };
}
