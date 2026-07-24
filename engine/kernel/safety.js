/**
 * engine/kernel/safety.js — fail-closed safety guard (ADR-0037 closing, item 3).
 * ===========================================================================================
 * A POLICY layer, not a contradiction engine. An axis classified as safety / allergen /
 * compatibility / legal may be enforced HARD only from a SINGLE official source with NO competing
 * evidence. If two sources disagree — or the only evidence is unofficial — the claim is
 * CONTRADICTED / UNKNOWN, never a silent SAT. The kernel already excludes never-relax UNKNOWN, so a
 * CONTRADICTED safety claim removes the product from that path rather than risking a false "safe".
 *
 * No funnel currently declares such an axis — this guard is PREVENTIVE, wired so that the day one
 * exists it fails closed by construction. Pure, deterministic.
 */

export const SAFETY_CATEGORIES = ["safety", "allergen", "compatibility", "legal"];

/** Is this axis a safety-critical category? (from an explicit axis.category tag). */
export function isSafetyAxis(axis) {
  return !!(axis && axis.category && SAFETY_CATEGORIES.includes(String(axis.category).toLowerCase()));
}

/**
 * Resolve safety evidence into a grounded claim, FAIL-CLOSED.
 * @param {Array} evidences  [{ value, official:boolean, source }]
 * @returns {{ status:"grounded"|"contradicted"|"unknown", value?, reason }}
 *   • grounded  — exactly one official source, no other official source disagreeing.
 *   • contradicted — ≥2 official sources with different values (never silently pick one).
 *   • unknown   — no official source (unofficial evidence never makes a safety claim SAT).
 */
export function resolveSafetyEvidence(evidences) {
  const official = (evidences || []).filter((e) => e && e.official);
  if (!official.length) return { status: "unknown", reason: "no official source for a safety claim" };
  const values = new Set(official.map((e) => String(e.value)));
  if (values.size > 1) return { status: "contradicted", reason: "official sources disagree — fail closed" };
  return { status: "grounded", value: official[0].value, reason: "single official source, no competing evidence" };
}

/**
 * Compile a safety axis into a NEVER_RELAX + require-proof constraint (so UNKNOWN/CONTRADICTED
 * excludes the candidate). Returns null if the axis isn't safety-classified.
 */
export function safetyConstraintFor(axis) {
  if (!isSafetyAxis(axis)) return null;
  return { id: axis.id, label: axis.label, type: "nominal", mode: "NEVER_RELAX", strict: true, requireProof: true, priority: 0, order: (axis.values || []).map((v) => String(v.value)), category: axis.category };
}

export default { SAFETY_CATEGORIES, isSafetyAxis, resolveSafetyEvidence, safetyConstraintFor };
