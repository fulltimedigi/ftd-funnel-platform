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

export const AXIS_RULE_ID = "most-options-first@v1";

/** @param {{[axisId:string]: number}} axisOptionCounts — counts ONLY. @returns {string|null} chosen axis. */
export function chooseAxis(axisOptionCounts = {}) {
  const entries = Object.entries(axisOptionCounts).filter(([, n]) => Number.isInteger(n) && n > 0);
  if (!entries.length) return null;
  entries.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries[0][0];
}

export default { chooseAxis, AXIS_RULE_ID };
