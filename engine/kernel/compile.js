/**
 * engine/kernel/compile.js — compile authored fact-axes + a real catalog into the kernel's
 * typed constraints + recommendable units (ADR-0037). This is the ONLY adapter between the
 * authoring vocabulary (axisSet with .hard/.ordinal/.profile) and the constraint kernel, so
 * the kernel stays the single authority on matching meaning (Guardrail G1).
 *
 * Constraint typing (grounded strictness — a value is trusted only where the profile actually
 * carries it; an absent profile entry arrives at the kernel as UNKNOWN, never a silent match):
 *   • format axis (hard, categorical)  → nominal, strict, NEVER_RELAX, priority 0
 *   • budget axis (hard, ordinal tiers)→ ordinal, RELAXABLE (nearest tier), priority 1
 *   • every soft axis                  → nominal, RELAXABLE, one shared priority (2) so their
 *                                        violations sum at a single level (like the old soft score)
 */

import { NEVER_RELAX, RELAXABLE } from "./constraintKernel.js";

/**
 * @param {Array} axisSet authored axes: { id, label, question, hard?, ordinal?, values:[{value,label}], profile:Map<url,value> }
 * @returns {Array} typed constraints
 */
export function compileConstraints(axisSet) {
  const hardIds = axisSet.filter((a) => a.hard).map((a) => a.id);
  return axisSet.map((a) => {
    const order = a.values.map((v) => String(v.value));
    if (a.hard && a.ordinal) {
      return { id: a.id, label: a.label, type: "ordinal", mode: RELAXABLE, strict: true, priority: hardIds.indexOf(a.id), order, values: a.values };
    }
    if (a.hard) {
      return { id: a.id, label: a.label, type: "nominal", mode: NEVER_RELAX, strict: true, priority: hardIds.indexOf(a.id), order, values: a.values };
    }
    // soft axes share the first priority after the hard ranks, so their violations aggregate
    // at one level (the kernel sums them) — reproducing the old uniform soft cost, but now with
    // three-valued honesty (a null profile entry is UNKNOWN, disclosed, never a silent match).
    return { id: a.id, label: a.label, type: "nominal", mode: RELAXABLE, strict: false, priority: hardIds.length, order, values: a.values };
  });
}

/**
 * Products → kernel units. Each unit's per-constraint value comes from the axis profile; a
 * missing entry is left ABSENT so the kernel reads it as UNKNOWN (grounded strictness). A
 * product with buyable variants can carry them for the variant predicate (not used by the
 * fact-axis authoring path yet, but the shape is honoured).
 */
export function compileUnits(products, axisSet) {
  return products.map((p) => {
    const values = new Map();
    for (const a of axisSet) {
      const v = a.profile.get(p.url);
      if (v != null) values.set(a.id, { value: v, grounded: true });
      // absent → UNKNOWN in the kernel (never a silent wildcard match)
    }
    return { id: p.url, product: p, variantId: null, variants: p.variants || null, values };
  });
}

/** Answers for a materialization combo: constraintId → the combo's value on that axis. */
export function comboAnswers(axisSet, combo) {
  const answers = {};
  axisSet.forEach((a, i) => { answers[a.id] = combo[i]; });
  return answers;
}

export default { compileConstraints, compileUnits, comboAnswers };
