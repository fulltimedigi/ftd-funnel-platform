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
    // context_ref (C1) — binds every edge to the CONTEXT its child was evaluated under. Round-3 (#3):
    // it also folds an axis_contract_digest, so two contexts with the SAME three versions but DIFFERENT
    // axis contracts (thresholds/predicates) never collide on one ref (cache/indexing safety).
    const axis_contract_digest = fnvHex(JSON.stringify(constraints.map((c) => ({
      id: String(c.id), type: c.type || null, mode: c.mode || null, order: c.order || null, resolved: c.resolved || null,
    })).sort((a, b) => (a.id < b.id ? -1 : 1))));
    this._contextRef = "ctx_" + fnvHex(JSON.stringify({
      s: context.structural_catalog_version ?? null, p: context.policy_version ?? null, k: context.kernel_version ?? null, a: axis_contract_digest,
    }));
    this._registry = new PoolRegistry();
    this._cache = new Map();      // evaluation_hash → { ev, pools, sets }
    this._transcript = [];
    this._considered = [];        // every option the session was ASKED to evaluate — each has a minted call
    this.callCount = 0;           // actual kernel evaluations (cache misses)
    this.cacheHitCount = 0;
  }

  evaluate(answers = {}, { opts, meta } = {}) { return this._commit(answers, opts, null, "ROOT", { meta }); }

  /** REFINE — a monotone narrowing. Throws (NOT silently accepts) if any monotonicity clause breaks. */
  refine(parent, answers = {}, { opts, meta } = {}) {
    this._assertNode(parent);
    const child = this._sets(answers, opts);
    const p = this._cache.get(parent.evaluation_hash).sets;
    const v = monotoneViolation(p, child);
    if (v) throw new Error("illegal REFINE (" + v + ") — a REFINE must only narrow; use branch()/relax() for a non-monotone move");
    return this._commit(answers, opts, parent, "REFINE", { meta });
  }

  branch(parent, answers = {}, { opts, meta } = {}) {
    this._assertNode(parent);
    return this._commit(answers, opts, parent, "BRANCH", { meta });
  }

  /** RELAX — a deliberately NON-monotone move (drops/loosens a promise). transition_kind is enforced in
   *  code: the four-part monotonicity check runs on REFINE ONLY, so a RELAX that grows the eligible pool
   *  is accepted (it would be wrongly rejected if monotonicity were assumed for every transition). */
  relax(parent, answers = {}, { opts, meta } = {}) {
    this._assertNode(parent);
    return this._commit(answers, opts, parent, "RELAX", { meta });
  }

  /**
   * PROBE (round-3, C3) — evaluate an option under `parent` WITHOUT publishing a tree edge. It records a
   * transcript entry (so option-completeness can require an evaluation for every enumerated option) and
   * enforces REFINE monotonicity, but mints no edge — a probed-but-not-published option leaves a transcript
   * mark, never an authorized tree edge. Returns the same handle shape minus `lineage_receipt`.
   */
  probe(parent, answers = {}, { opts, meta } = {}) {
    this._assertNode(parent);
    const child = this._sets(answers, opts);
    const p = this._cache.get(parent.evaluation_hash).sets;
    const v = monotoneViolation(p, child);
    if (v) throw new Error("illegal PROBE as REFINE (" + v + ")");
    return this._commit(answers, opts, parent, "PROBE", { mintEdge: false, meta });
  }

  /** SERVER-ONLY: resolve an opaque pool ref to member ids (certifier / differential). */
  membersOf(ref) { return this._registry.resolve(ref); }

  /** SERVER-ONLY: the answers that produced a node (for option enumeration; never exposed to the brain). */
  answersOf(node) { this._assertNode(node); return { ...(this._cache.get(node.evaluation_hash).answers || {}) }; }

  /**
   * TREE-level verification (round-3, C1). Given the published nodes of a tree, assert:
   *   • every non-root node's edge MAC verifies (parent + child_pool + transition + child_hash + context),
   *   • each edge's `child_evaluation_hash` equals the node's actual hash and `parent_pool_ref` equals the
   *     node's actual parent pool, and
   *   • the SET of tree edges equals the SET of ALL minted edges EXACTLY (no valid edge assembled into an
   *     unauthorized tree; no minted edge silently dropped).
   */
  verifyTree(nodes = []) {
    const childNodes = nodes.filter((n) => n && n.transition && n.transition.lineage_receipt);
    const treeEdgeRefs = [...new Set(childNodes.map((n) => n.transition.lineage_receipt.ref))].sort();
    const mintedRefs = [...this._registry.allEdgeRefs()].sort();
    const findings = [];
    const bijection = treeEdgeRefs.length === mintedRefs.length && treeEdgeRefs.every((r, i) => r === mintedRefs[i]);
    if (!bijection) findings.push(`tree edges (${treeEdgeRefs.length}) ≠ minted edges (${mintedRefs.length}) — set mismatch`);
    for (const n of childNodes) {
      const rec = n.transition.lineage_receipt;
      if (!this._registry.verifyEdge(rec)) findings.push("edge MAC invalid: " + rec.ref);
      if (rec.child_evaluation_hash !== n.evaluation_hash) findings.push("edge child_evaluation_hash ≠ node hash: " + rec.ref);
      const parentEntry = this._cache.get(n.transition.parent_hash);
      if (!parentEntry || rec.parent_pool_ref !== parentEntry.pools.eligible_ref) findings.push("edge parent_pool_ref ≠ actual parent pool: " + rec.ref);
    }
    return { ok: findings.length === 0, findings, treeEdges: treeEdgeRefs.length, mintedEdges: mintedRefs.length };
  }

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

  _commit(answers, opts, parent, transition_kind, { mintEdge = true, meta = {} } = {}) {
    meta = meta || {};
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
      entry = { ev, pools, sets, answers: { ...answers } };
      this._cache.set(evaluation_hash, entry);
    }

    const parent_hash = parent ? parent.evaluation_hash : null;
    // qualified_option_ref — the kernel names the transition; the brain cannot fabricate one that verifies.
    const qualified_option_ref = "qopt_" + fnvHex([parent_hash || "root", transition_kind, JSON.stringify(canonicalAnswers(answers)), evaluation_hash].join("|"));
    // EDGE receipt — authorizes THIS parent → THIS child evaluation, under THIS context (C1), keyed by
    // (parent, transition). A PROBE mints NO edge (mintEdge:false) — evaluated, not published.
    const lineage_receipt = parent && mintEdge
      ? this._registry.mintEdge({ parent_pool_ref: parent.pools.eligible_ref, child_pool_ref: entry.pools.eligible_ref, transition_ref: qualified_option_ref, transition_kind, child_evaluation_hash: evaluation_hash, context_ref: this._contextRef })
      : null;

    // Round-3 (#1): every transcript entry carries NODE IDENTITY (parent_pool_ref + context_ref + axis_id +
    // option_ref) + exact_count, so option-completeness and the two-ledger link can be measured PER NODE.
    this._transcript.push({
      evaluation_hash, transition_kind, parent_hash, state_outcome: entry.ev.state_outcome,
      published: !!lineage_receipt,
      parent_pool_ref: parent ? parent.pools.eligible_ref : null,
      context_ref: this._contextRef,
      axis_id: meta.axis_id ?? null,
      option_ref: meta.option_ref ?? null,
      exact_count: entry.sets.exact.size,
    });

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
