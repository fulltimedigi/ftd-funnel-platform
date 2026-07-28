/**
 * engine/kernel/authoringOracle/session.js — the ORACLE SESSION (ADR-0046). Server-side.
 * ===========================================================================================
 * Stateful orchestration over the pure `evaluateState`, WITHIN one funnel only. It MINTS opaque pools
 * (membership) and AUTHORIZED edges (a transition receipt per parent→child edge), records an
 * OracleTranscript (proof material), memoizes evaluations in a cache whose identity includes
 * kernel_version, and mediates TRANSITIONS (ROOT / REFINE / BRANCH).
 *
 * STATELESS BETWEEN FUNNELS (consultation round-2, #1b): a session holds no learned patterns from any
 * other funnel; every tree is derived from ITS OWN transcript alone. Two sessions share nothing but the
 * pure kernel — proven in tests. The brain is a THIN CLIENT: it receives only the authoring `projection`
 * and a kernel-minted `qualified_option_ref`; it never sees a roster, mints a pool, or fabricates a
 * transition.
 *
 * MONOTONICITY (REFINE), enforced in code — a REFINE must satisfy ALL of (consultation round-2, #4):
 *   exact(child) ⊆ exact(parent)   — adding a promise can NEVER promote compromise→exact
 *   eligible(child) ⊆ eligible(parent)
 *   rejected(child) ⊇ rejected(parent)
 *   and NO candidate moves compromise→exact.
 * Any violation throws (the brain must BRANCH). BRANCH is exempt.
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
    this._cache = new Map();      // evaluation_hash → { ev, pools, sets }
    this._transcript = [];
    this._considered = [];        // every option the session was ASKED to evaluate — each has a minted call
    this.callCount = 0;           // actual kernel evaluations (cache misses)
    this.cacheHitCount = 0;
  }

  evaluate(answers = {}, { opts } = {}) { return this._commit(answers, opts, null, "ROOT"); }

  /** REFINE — a monotone narrowing. Throws (NOT silently accepts) if any monotonicity clause breaks. */
  refine(parent, answers = {}, { opts } = {}) {
    this._assertNode(parent);
    const child = this._sets(answers, opts);
    const p = this._cache.get(parent.evaluation_hash).sets;
    const v = monotoneViolation(p, child);
    if (v) throw new Error("illegal REFINE (" + v + ") — a REFINE must only narrow; use branch() for a non-monotone move");
    return this._commit(answers, opts, parent, "REFINE");
  }

  branch(parent, answers = {}, { opts } = {}) {
    this._assertNode(parent);
    return this._commit(answers, opts, parent, "BRANCH");
  }

  /** SERVER-ONLY: resolve an opaque pool ref to member ids (certifier / differential). */
  membersOf(ref) { return this._registry.resolve(ref); }

  /**
   * Verify a node's lineage. Two independent authentications:
   *   • membership — `tamperMembers` breaks the POOL mac.
   *   • authorization — `tamperParent` forges the EDGE's parent and breaks the EDGE mac.
   */
  verifyLineage(node, { tamperMembers, tamperParent } = {}) {
    this._assertNode(node);
    if (tamperMembers) return this._registry.verifyPool(node.pools.eligible_ref, { members: tamperMembers });
    const edge = node.transition.lineage_receipt;
    if (tamperParent) return edge ? this._registry.verifyEdge(edge, { parent_pool_ref: "pool_forged_parent" }) : false;
    const memberOk = this._registry.verifyPool(node.pools.eligible_ref);
    return node.transition.kind === "ROOT" ? memberOk : memberOk && this._registry.verifyEdge(edge);
  }

  verifyTransition(qualified_option_ref, node) {
    this._assertNode(node);
    return qualified_option_ref === node.transition.qualified_option_ref;
  }

  transcript() { return this._transcript.map((e) => ({ ...e })); }
  considered() { return this._considered.map((e) => ({ ...e })); }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  _assertNode(n) {
    if (!n || !n.evaluation_hash || !this._cache.has(n.evaluation_hash)) throw new Error("unknown oracle node (pass back the handle from evaluate/refine/branch)");
  }

  /** Class member sets for an answer-path (used by monotonicity — computed WITHOUT minting/side effects). */
  _sets(answers, opts) {
    const ev = evaluateState({ units: this._units, constraints: this._constraints, answers, context: this._context, opts });
    return { exact: new Set(ev.exact_ids), eligible: new Set([...ev.exact_ids, ...ev.compromise_ids]), rejected: new Set(ev.rejected_ids), compromise: new Set(ev.compromise_ids) };
  }

  _commit(answers, opts, parent, transition_kind) {
    const evaluation_hash = oracleHash({ units: this._units, constraints: this._constraints, answers, context: this._context, opts });
    this._considered.push({ evaluation_hash, transition_kind }); // EVERY option considered leaves a minted call

    let entry = this._cache.get(evaluation_hash);
    if (entry) {
      this.cacheHitCount++;
    } else {
      this.callCount++;
      const ev = evaluateState({ units: this._units, constraints: this._constraints, answers, context: this._context, opts });
      const eligibleMembers = [...ev.exact_ids, ...ev.compromise_ids].map(String).sort();
      const pools = {
        exact_ref: this._registry.mintPool("exact", ev.exact_ids, { evaluation_hash }).ref,
        compromise_ref: this._registry.mintPool("compromise", ev.compromise_ids, { evaluation_hash }).ref,
        rejected_ref: this._registry.mintPool("rejected", ev.rejected_ids, { evaluation_hash }).ref,
        eligible_ref: this._registry.mintPool("eligible", eligibleMembers, { evaluation_hash }).ref,
      };
      const sets = { exact: new Set(ev.exact_ids), eligible: new Set(eligibleMembers), rejected: new Set(ev.rejected_ids), compromise: new Set(ev.compromise_ids) };
      entry = { ev, pools, sets };
      this._cache.set(evaluation_hash, entry);
    }

    const parent_hash = parent ? parent.evaluation_hash : null;
    // qualified_option_ref — the kernel names the transition; the brain cannot fabricate one that verifies.
    const qualified_option_ref = "qopt_" + fnvHex([parent_hash || "root", transition_kind, JSON.stringify(canonicalAnswers(answers)), evaluation_hash].join("|"));
    // EDGE receipt — authorizes THIS parent → THIS child via THIS transition (keyed by parent+transition).
    const lineage_receipt = parent
      ? this._registry.mintEdge({ parent_pool_ref: parent.pools.eligible_ref, child_pool_ref: entry.pools.eligible_ref, transition_ref: qualified_option_ref, transition_kind })
      : null;

    this._transcript.push({ evaluation_hash, transition_kind, parent_hash, state_outcome: entry.ev.state_outcome });

    return Object.freeze({
      projection: projectForAuthoring(entry.ev),
      evaluation_hash,
      cache_key: evaluation_hash,
      pools: Object.freeze({ ...entry.pools }),
      transition: Object.freeze({ kind: transition_kind, parent_hash, qualified_option_ref, lineage_receipt: lineage_receipt ? Object.freeze(lineage_receipt) : null }),
    });
  }
}

/** ALL monotonicity clauses for a REFINE. Returns a reason string on the first violation, else null. */
function monotoneViolation(parent, child) {
  const subset = (a, b) => [...a].every((x) => b.has(x));
  if (!subset(child.exact, parent.exact)) return "exact(child) ⊄ exact(parent): a promise promoted compromise→exact";
  if (!subset(child.eligible, parent.eligible)) return "eligible(child) ⊄ eligible(parent): the eligible pool grew";
  if (!subset(parent.rejected, child.rejected)) return "rejected(parent) ⊄ rejected(child): a rejected candidate re-entered";
  for (const x of child.exact) if (parent.compromise.has(x)) return "compromise→exact movement for " + x;
  return null;
}

function canonicalAnswers(answers) {
  return Object.keys(answers || {}).sort().map((k) => [k, answers[k]]);
}

export default { OracleSession };
