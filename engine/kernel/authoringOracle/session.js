/**
 * engine/kernel/authoringOracle/session.js — the ORACLE SESSION (ADR-0046). Server-side.
 * ===========================================================================================
 * Stateful orchestration over the pure `evaluateState`: it MINTS opaque pools (PoolRegistry), records
 * an OracleTranscript (proof material), memoizes evaluations in a cache whose identity includes
 * kernel_version, and mediates TRANSITIONS (ROOT / REFINE / BRANCH) with kernel-minted lineage.
 *
 * The brain is a THIN CLIENT: it receives ONLY the authoring `projection` (counts + state_outcome +
 * opaque refs) and a `qualified_option_ref` to name a transition. It never sees a roster, never mints
 * a pool, never fabricates a transition — those are kernel monopolies enforced here (MAC + verify).
 *
 * INVARIANTS enforced in code (not just asserted in tests): MONOTONICITY — a REFINE may only SHRINK
 * the eligible pool; a non-shrinking REFINE throws (the brain must use BRANCH). Single Evaluation
 * Origin — the evaluation_hash is `oracleHash(primary inputs)`; the cache keys on it, so two kernel
 * builds never share a line.
 */

import { evaluateState } from "./evaluateState.js";
import { projectForAuthoring } from "./projections.js";
import { PoolRegistry } from "./poolRegistry.js";
import { oracleHash, fnvHex } from "./hash.js";

export class OracleSession {
  constructor({ constraints, units, context } = {}) {
    if (!Array.isArray(constraints) || !Array.isArray(units)) throw new Error("OracleSession requires constraints[] and units[]");
    if (!context || !context.kernel_version) throw new Error("OracleSession requires a context carrying kernel_version (evaluation identity)");
    this._constraints = constraints;
    this._units = units;
    this._context = context;
    this._registry = new PoolRegistry();
    this._cache = new Map();      // evaluation_hash → { ev, pools, eligibleMembers }
    this._transcript = [];
    this.callCount = 0;           // actual kernel evaluations (cache misses)
    this.cacheHitCount = 0;
  }

  /** ROOT evaluation for a set of answers. */
  evaluate(answers = {}, { opts } = {}) {
    return this._commit(answers, opts, null, "ROOT");
  }

  /** REFINE: a monotone narrowing of a parent state (adds/tightens a promise). Throws if it grows. */
  refine(parent, answers = {}, { opts } = {}) {
    this._assertNode(parent);
    // Pre-check monotonicity BEFORE any side effect: child eligible must be ⊆ parent eligible.
    const childEligible = this._eligibleMembers(answers, opts);
    const parentEligible = new Set(this._cache.get(parent.evaluation_hash).eligibleMembers);
    const grows = childEligible.some((x) => !parentEligible.has(x));
    if (grows) throw new Error("illegal REFINE: it would GROW the eligible pool (not monotonic) — use branch() for a non-narrowing move");
    return this._commit(answers, opts, parent, "REFINE");
  }

  /** BRANCH: a non-monotone move to a sibling state (a different question path). */
  branch(parent, answers = {}, { opts } = {}) {
    this._assertNode(parent);
    return this._commit(answers, opts, parent, "BRANCH");
  }

  /** SERVER-ONLY: resolve an opaque pool ref back to its member ids (certifier / differential use). */
  membersOf(ref) {
    return this._registry.resolve(ref);
  }

  /** Verify a node's lineage receipt. `tamperMembers` simulates a poisoned pool (the MAC must reject). */
  verifyLineage(node, { tamperMembers } = {}) {
    this._assertNode(node);
    const ref = node.pools.eligible_ref;
    return tamperMembers ? this._registry.verify(ref, { members: tamperMembers }) : this._registry.verify(ref);
  }

  /** Verify a transition is named by the genuine kernel-minted option ref (a fabricated one fails). */
  verifyTransition(qualified_option_ref, node) {
    this._assertNode(node);
    return qualified_option_ref === node.transition.qualified_option_ref;
  }

  /** The OracleTranscript — an ordered, append-only proof record of every step. */
  transcript() {
    return this._transcript.map((e) => ({ ...e }));
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  _assertNode(n) {
    if (!n || !n.evaluation_hash || !this._cache.has(n.evaluation_hash)) throw new Error("unknown oracle node (evaluate/refine/branch returns the handle to pass back)");
  }

  _eligibleMembers(answers, opts) {
    const ev = evaluateState({ units: this._units, constraints: this._constraints, answers, context: this._context, opts });
    return [...ev.exact_ids, ...ev.compromise_ids].map(String).sort();
  }

  _commit(answers, opts, parent, transition_kind) {
    const evaluation_hash = oracleHash({ units: this._units, constraints: this._constraints, answers, context: this._context, opts });

    let entry = this._cache.get(evaluation_hash);
    if (entry) {
      this.cacheHitCount++;
    } else {
      this.callCount++;
      const ev = evaluateState({ units: this._units, constraints: this._constraints, answers, context: this._context, opts });
      const eligibleMembers = [...ev.exact_ids, ...ev.compromise_ids].map(String).sort();
      const parent_ref = parent ? parent.pools.eligible_ref : null;
      const pools = {
        exact_ref: this._registry.mint("exact", ev.exact_ids, { evaluation_hash, parent_ref, transition_kind }).ref,
        compromise_ref: this._registry.mint("compromise", ev.compromise_ids, { evaluation_hash, parent_ref, transition_kind }).ref,
        rejected_ref: this._registry.mint("rejected", ev.rejected_ids, { evaluation_hash, parent_ref, transition_kind }).ref,
        eligible_ref: this._registry.mint("eligible", eligibleMembers, { evaluation_hash, parent_ref, transition_kind }).ref,
      };
      entry = { ev, pools, eligibleMembers };
      this._cache.set(evaluation_hash, entry);
    }

    const parent_hash = parent ? parent.evaluation_hash : null;
    // qualified_option_ref — the kernel names the transition; the brain cannot fabricate one that verifies.
    const qualified_option_ref = "qopt_" + fnvHex([parent_hash || "root", transition_kind, JSON.stringify(canonicalAnswers(answers)), evaluation_hash].join("|"));
    const lineage_receipt = this._registry.verify(entry.pools.eligible_ref)
      ? { ref: entry.pools.eligible_ref, mac: "ok" } // the MAC lives in the registry; the handle carries a reference, not the secret material
      : { ref: entry.pools.eligible_ref, mac: null };

    this._transcript.push({ evaluation_hash, transition_kind, parent_hash, state_outcome: entry.ev.state_outcome });

    return Object.freeze({
      projection: projectForAuthoring(entry.ev),
      evaluation_hash,
      cache_key: evaluation_hash,
      pools: Object.freeze({ ...entry.pools }),
      transition: Object.freeze({ kind: transition_kind, parent_hash, qualified_option_ref, lineage_receipt: Object.freeze(lineage_receipt) }),
    });
  }
}

function canonicalAnswers(answers) {
  return Object.keys(answers || {}).sort().map((k) => [k, answers[k]]);
}

export default { OracleSession };
