/**
 * authoring/brain2/tree.js — PHASE B: a general N-level tree, oracle-authored. Imports no predicate/catalog.
 * ===========================================================================================
 * At each node it enumerates every unused axis (opaque refs), applies a DECLARED counts-only rule to pick
 * the axis, and publishes options by the round-3 COMPROMISE-PUBLISH rule (correction 4):
 *   exact ≠ 0                    → publish (preferred).
 *   exact = 0 ∧ compromise ≠ 0   → publish as a COMPROMISE leaf (the deviation is confined to the named
 *                                  relaxable axis — hard constraints are already excluded from compromise).
 *   exact = 0 ∧ compromise = 0   → NEVER publish (this is the dead-end the rule forbids).
 * `RULE_V1` (most-options) and `RULE_V2` (max-info-gain) are both counts-only; the builder is rule-agnostic.
 */

import { chooseAxis, AXIS_RULE_ID, chooseAxisByInfoGain, AXIS_RULE_ID_V2 } from "./axisRule.js";

export const RULE_V1 = {
  id: AXIS_RULE_ID,
  pick(node, perAxisRefs) {
    const counts = Object.fromEntries(Object.entries(perAxisRefs).map(([ax, refs]) => [ax, refs.length]));
    return chooseAxis(counts);
  },
};

export const RULE_V2 = {
  id: AXIS_RULE_ID_V2,
  pick(node, perAxisRefs, oracle) {
    // sizing: probe every option of every candidate axis → per-option ELIGIBLE sizes (counts only)
    const sizes = {};
    for (const [ax, refs] of Object.entries(perAxisRefs)) {
      sizes[ax] = refs.map(({ option_ref }) => { const p = oracle.probeByRef(node, option_ref); const c = p.projection.counts; return c.exact + c.compromise; });
    }
    return chooseAxisByInfoGain(sizes);
  },
};

export function buildTree(oracle, { maxDepth = 3, rule = RULE_V2 } = {}) {
  const axes = oracle.axisIds();
  const root = oracle.evaluateRoot();
  const nodes = [root];
  const internalChoices = [];
  const leaves = [];
  const meta = new Map(); // evaluation_hash → { compromiseOnly:boolean, depth }
  meta.set(root.evaluation_hash, { compromiseOnly: false, depth: 0 });

  function expand(node, used, depth) {
    if (depth >= maxDepth) { leaves.push(node); return; }
    const perAxisRefs = {};
    for (const ax of axes) { if (used.has(ax)) continue; const refs = oracle.enumerate(node, ax); if (refs.length) perAxisRefs[ax] = refs; }
    if (!Object.keys(perAxisRefs).length) { leaves.push(node); return; }

    const chosen = rule.pick(node, perAxisRefs, oracle);
    if (!chosen || !perAxisRefs[chosen]) { leaves.push(node); return; }
    internalChoices.push({ node, axisId: chosen });

    let publishedAny = false;
    for (const { option_ref } of perAxisRefs[chosen]) {
      const p = oracle.probeByRef(node, option_ref);
      const { exact, compromise } = p.projection.counts;
      if (exact > 0 || compromise > 0) { // publishable — never an empty (dead-end) leaf
        const child = oracle.publishByRef(node, option_ref);
        nodes.push(child);
        meta.set(child.evaluation_hash, { compromiseOnly: exact === 0 && compromise > 0, depth: depth + 1 });
        publishedAny = true;
        expand(child, new Set([...used, chosen]), depth + 1);
      }
    }
    if (!publishedAny) leaves.push(node);
  }

  expand(root, new Set(), 0);
  return { root, nodes, internalChoices, leaves, meta, ruleId: rule.id };
}

export default { buildTree, RULE_V1, RULE_V2 };
