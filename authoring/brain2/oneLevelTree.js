/**
 * authoring/brain2/oneLevelTree.js — PHASE B: a one-level decision tree, authored by the ORACLE ALONE.
 * ===========================================================================================
 * This is the thin-client brain. It imports NOTHING from engine/kernel (no predicate, no catalog, no
 * evaluator) — it is handed an AuthoringOracle facade and works only through its PRESENTATIONAL surface:
 * opaque `option_ref`s, display labels, and per-option `projection.counts`. It decides STRUCTURE
 * (which options to publish), never matching.
 *
 * Declared axis-selection rule (round-3, C3 — announced in advance, matched by the transcript):
 *   "the given axis, and EVERY qualified option the kernel enumerates at the root."
 * Publishing rule: publish exactly the options whose `exact` count is non-empty; an empty-exact option is
 * PROBED (a transcript mark) but not published (no dead-end leaf). No option is dropped without a probe.
 */

export const AXIS_SELECTION_RULE = "root-axis:all-qualified-options";

/**
 * @param {object} oracle  an AuthoringOracle (presentational surface only)
 * @param {string} axisId  the single axis this one-level tree branches on
 * @returns {{ root, axisId, options:Array<{option_ref,label,exact,published,child?}> , published:Array }}
 */
export function buildOneLevelTree(oracle, axisId) {
  const root = oracle.evaluateRoot();
  const enumerated = oracle.enumerate(root, axisId); // [{ option_ref, label }] — opaque + label only

  const options = [];
  const published = [];
  for (const { option_ref, label } of enumerated) {
    const probe = oracle.probeByRef(root, option_ref);          // counts only — no roster, no value
    const exact = probe.projection.counts.exact;
    if (exact > 0) {
      const child = oracle.publishByRef(root, option_ref);      // mint the tree edge (publish)
      options.push({ option_ref, label, exact, published: true, child });
      published.push({ option_ref, label, child });
    } else {
      options.push({ option_ref, label, exact, published: false }); // probed, not published (no dead-end)
    }
  }
  return { root, axisId, axisSelectionRule: AXIS_SELECTION_RULE, options, published };
}

export default { buildOneLevelTree, AXIS_SELECTION_RULE };
