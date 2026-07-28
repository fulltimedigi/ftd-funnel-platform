/**
 * engine/kernel/authoringOracle/enumerate.js — OPTION ENUMERATION from the kernel (round-3, C3).
 * ===========================================================================================
 * The set of options that MUST be evaluated at a node for an axis is decided by the KERNEL, never by
 * the brain's claim of "which are worth asking." `enumerateQualifiedOptions` returns every distinct
 * grounded value of `axisId` among the candidates ELIGIBLE at the current answers — the exact roster the
 * transcript must then cover (a narrowing beyond it is prediction). Pure, deterministic (sorted).
 */

import { classifyUnit } from "../constraintKernel.js";

function groundedValue(unit, id) {
  const g = unit.values && unit.values.get ? unit.values.get(id) : (unit.values || {})[id];
  if (g == null) return { value: null, grounded: false };
  if (typeof g === "object" && !Array.isArray(g) && "value" in g) return { value: g.value, grounded: g.grounded !== false };
  return { value: g, grounded: true };
}

/**
 * @returns {string[]} sorted distinct grounded values of `axisId` among units NOT rejected at `answers`.
 * These are the qualified options for a transition on `axisId`; the transcript must evaluate each exactly.
 */
export function enumerateQualifiedOptions(units, constraints, answers, axisId, opts = {}) {
  if (!Array.isArray(units) || !Array.isArray(constraints)) throw new Error("enumerateQualifiedOptions: units[]+constraints[] required");
  if (!constraints.some((c) => String(c.id) === String(axisId))) throw new Error(`enumerateQualifiedOptions: no constraint for axis "${axisId}"`);
  const seen = new Set();
  for (const u of units) {
    const { klass } = classifyUnit(u, constraints, answers || {}, opts);
    if (klass === "rejected") continue; // an already-excluded candidate contributes no askable option here
    const gv = groundedValue(u, axisId);
    if (gv.grounded && gv.value != null) seen.add(String(gv.value));
  }
  return [...seen].sort();
}

export default { enumerateQualifiedOptions };
