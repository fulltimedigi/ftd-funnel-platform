/**
 * authoring/brain2/twoLevelTree.js — PHASE B: a TWO-LEVEL tree (axis A then axis B), oracle-authored.
 * ===========================================================================================
 * Thin client. Imports NOTHING from engine/kernel (no predicate, no catalog). At each node it asks the
 * oracle to enumerate each unused axis (opaque refs), counts them, and applies the DECLARED counts-only
 * rule (axisRule.js) to pick the axis — never a hardcoded order. It probes every option (transcript mark)
 * and publishes only the non-empty-exact ones (no dead-end, no silent drop). Depth is capped at `maxDepth`.
 */

import { chooseAxis, AXIS_RULE_ID } from "./axisRule.js";

export function buildTwoLevelTree(oracle, { maxDepth = 2 } = {}) {
  const axes = oracle.axisIds();
  const root = oracle.evaluateRoot();
  const nodes = [root];
  const internalChoices = []; // [{ node, axisId }] — the axis the brain chose at each internal node
  const leaves = [];

  function expand(node, used, depth) {
    if (depth >= maxDepth) { leaves.push(node); return; }
    // enumerate every UNUSED axis → opaque refs; the COUNT (refs.length) is the only selection signal.
    const perAxis = {};
    for (const ax of axes) {
      if (used.has(ax)) continue;
      const refs = oracle.enumerate(node, ax);
      if (refs.length) perAxis[ax] = refs;
    }
    const counts = Object.fromEntries(Object.entries(perAxis).map(([ax, refs]) => [ax, refs.length]));
    const chosen = chooseAxis(counts);
    if (!chosen) { leaves.push(node); return; } // no further qualified axis → leaf
    internalChoices.push({ node, axisId: chosen });

    let publishedAny = false;
    for (const { option_ref } of perAxis[chosen]) {
      const probe = oracle.probeByRef(node, option_ref); // counts only
      if (probe.projection.counts.exact > 0) {
        const child = oracle.publishByRef(node, option_ref); // mint the tree edge
        nodes.push(child);
        publishedAny = true;
        expand(child, new Set([...used, chosen]), depth + 1);
      }
    }
    if (!publishedAny) leaves.push(node); // nothing publishable below → this node is a leaf
  }

  expand(root, new Set(), 0);
  return { root, nodes, internalChoices, leaves, axisRuleId: AXIS_RULE_ID };
}

export default { buildTwoLevelTree };
