/**
 * engine/kernel/authoringOracle/evaluateState.js — THE Kernel Authoring Oracle entry (ADR-0046).
 * ===========================================================================================
 * OWNERSHIP (governing rule): the oracle lives in the KERNEL path. It NEVER re-implements matching —
 * it orchestrates the kernel's own `classifyUnit` (the same eligibility + matchState runtime uses),
 * so authoring and runtime cannot diverge on what "matches" means. The brain is a THIN CLIENT: it
 * imports NONE of this; it consumes only the AUTHORING PROJECTION (see projections.js) — counts,
 * state_outcome, and OPAQUE pool refs. No predicate, no SKU test, no id roster ever crosses to it.
 *
 * `evaluateState` returns the rich, kernel-internal StateEvaluation (it DOES carry ids and the
 * evaluation_hash — this object stays inside the kernel/server). It classifies EVERY candidate into
 * a strict partition (exact ⊎ compromise ⊎ rejected = pool), derives the state_outcome, and stamps a
 * reconstructible evaluation_hash (Single Evaluation Origin, measured by hash — no random ref).
 */

import { classifyUnit } from "../constraintKernel.js";
import { oracleHash } from "./hash.js";

/**
 * @param {Object}  args
 * @param {Array}   args.units        candidate pool (product shells; may carry .variants)
 * @param {Array}   args.constraints  typed constraint state
 * @param {Object}  args.answers      constraintId → answer
 * @param {Object}  args.context      { structural_catalog_version, policy_version, kernel_version }
 * @param {Object} [args.opts]        forwarded to classifyUnit (e.g. merchant price bounds)
 * @returns StateEvaluation (frozen, kernel-internal): { exact_ids, compromise_ids, rejected_ids,
 *          counts, state_outcome, evaluation_hash }.
 */
export function evaluateState({ units, constraints, answers, context, opts } = {}) {
  if (!Array.isArray(units)) throw new Error("evaluateState: units[] required");
  if (!Array.isArray(constraints)) throw new Error("evaluateState: constraints[] required");

  const exact_ids = [], compromise_ids = [], rejected_ids = [];
  const seen = new Set();
  for (const u of units) {
    if (u == null || u.id == null) throw new Error("evaluateState: every candidate needs an id");
    const id = String(u.id);
    if (seen.has(id)) throw new Error(`evaluateState: duplicate candidate id "${id}" (a pool is a set)`);
    seen.add(id);
    const { klass } = classifyUnit(u, constraints, answers || {}, opts || {});
    if (klass === "exact") exact_ids.push(id);
    else if (klass === "compromise") compromise_ids.push(id);
    else rejected_ids.push(id);
  }
  exact_ids.sort(); compromise_ids.sort(); rejected_ids.sort();

  const counts = { exact: exact_ids.length, compromise: compromise_ids.length, rejected: rejected_ids.length };
  // state_outcome is DERIVED here (never handed in): exact dominates; else any compromise; else honest none.
  const state_outcome = counts.exact > 0 ? "EXACT_AVAILABLE" : counts.compromise > 0 ? "COMPROMISE_ONLY" : "HONEST_NO_MATCH";

  const evaluation_hash = oracleHash({ units, constraints, answers: answers || {}, context });

  return Object.freeze({
    exact_ids: Object.freeze(exact_ids),
    compromise_ids: Object.freeze(compromise_ids),
    rejected_ids: Object.freeze(rejected_ids),
    counts: Object.freeze(counts),
    state_outcome,
    evaluation_hash,
  });
}

export default { evaluateState };
