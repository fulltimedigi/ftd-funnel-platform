/**
 * engine/kernel/authoringOracle/projections.js — PROJECTIONS of a StateEvaluation (ADR-0046).
 * ===========================================================================================
 * A projection DELETES fields; it never adds a `mode`. Each projection is the ONLY thing a given
 * consumer is allowed to see — the rich StateEvaluation never leaves the kernel/server whole.
 *
 * projectForAuthoring — what the BRAIN (thin client) sees. Projection PURITY (invariant): it carries
 * NO candidate ids, NO violation_vectors, NO evidence_receipts, NO scores, NO ranking, NO pool_digest.
 * The brain sees only:
 *   • state_outcome          — EXACT_AVAILABLE | COMPROMISE_ONLY | HONEST_NO_MATCH
 *   • counts                 — how many in each class (a count is not a roster)
 *   • *_pool_ref             — OPAQUE handles (a digest, not the member ids; not reversible to ids)
 * With this alone the brain can shape structure (branch, ask, or honestly stop) WITHOUT ever learning
 * which SKU matched or why — matching stays the kernel's monopoly.
 */

import { poolRef } from "./hash.js";

export function projectForAuthoring(ev) {
  if (!ev || ev.evaluation_hash == null) throw new Error("projectForAuthoring: a StateEvaluation is required");
  return Object.freeze({
    state_outcome: ev.state_outcome,
    counts: Object.freeze({ exact: ev.counts.exact, compromise: ev.counts.compromise, rejected: ev.counts.rejected }),
    exact_pool_ref: poolRef("exact", ev.exact_ids, ev.evaluation_hash),
    compromise_pool_ref: poolRef("compromise", ev.compromise_ids, ev.evaluation_hash),
    rejected_pool_ref: poolRef("rejected", ev.rejected_ids, ev.evaluation_hash),
  });
}

export default { projectForAuthoring };
