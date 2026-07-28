/**
 * engine/kernel/authoringOracle/authoringOracle.js — the AUTHORING ORACLE FACADE (round-3, C4).
 * ===========================================================================================
 * Splits the axis contract so two-phase isolation is STRUCTURAL, not disciplinary:
 *   • RESOLVED contract (here, kernel-side): predicates, thresholds, evidence bindings, resolved value
 *     range — becomes the kernel constraint. NEVER handed out.
 *   • PRESENTATIONAL contract (to phase B / brain2): `axis_id`, opaque `option_ref`s, display `label`s.
 *     Phase B does not know "low" means ≤t — it knows there is an option, its label, and (after a probe)
 *     its counts. It references options only by the kernel-minted `option_ref`; it cannot fabricate an
 *     answer because it never holds a value. "Build a matcher from projection data" is unrepresentable.
 *
 * Server-side. Wraps OracleSession (the 4-a primitive). The one-level tree builder (phase B) takes an
 * instance of THIS and calls only its presentational surface.
 */

import { OracleSession } from "./session.js";
import { enumerateQualifiedOptions } from "./enumerate.js";
import { fnvHex } from "./hash.js";

export class AuthoringOracle {
  /**
   * @param {{units:Array, resolvedContracts:Array, context:Object, labels?:Object}} args
   *   resolvedContracts: [{ axis_id, type, mode, priority, order?, resolved?, descendants?, requireProof? }]
   *   labels: { "<axis_id>|<value>": "<display label>" } — presentational only (optional; defaults to the value).
   */
  constructor({ units, resolvedContracts, context, labels } = {}) {
    if (!Array.isArray(units) || !Array.isArray(resolvedContracts)) throw new Error("AuthoringOracle requires units[] + resolvedContracts[]");
    this._units = units;
    // RESOLVED → kernel constraints (id = axis_id). The `resolved` predicate rides into the hash (C2).
    this._constraints = resolvedContracts.map((c) => ({
      id: c.axis_id, type: c.type, mode: c.mode, priority: c.priority || 0,
      order: c.order || undefined, resolved: c.resolved || undefined,
      descendants: c.descendants || undefined, requireProof: !!c.requireProof, strict: !!c.strict,
    }));
    this._context = context;
    this._labels = labels || {};
    this._session = new OracleSession({ units, constraints: this._constraints, context });
    this._optionRefs = new Map(); // option_ref → { axis_id, value }  (kernel-side; never exposed)
  }

  /** ROOT node. */
  evaluateRoot() { return this._session.evaluate({}); }

  /**
   * PRESENTATIONAL enumeration for phase B: the kernel enumerates the qualified options at `node` for
   * `axisId` and returns OPAQUE refs + display labels — no values, no thresholds, no roster.
   */
  enumerate(node, axisId) {
    const answers = this._session.answersOf(node);
    const values = enumerateQualifiedOptions(this._units, this._constraints, answers, axisId);
    return values.map((v) => {
      const option_ref = "opt_" + fnvHex(axisId + "|" + v);
      this._optionRefs.set(option_ref, { axis_id: axisId, value: v });
      return { option_ref, label: this._labels[axisId + "|" + v] ?? String(v) };
    });
  }

  _answerFor(parent, option_ref) {
    const o = this._optionRefs.get(option_ref);
    if (!o) throw new Error("unknown option_ref (enumerate first — the brain cannot fabricate one): " + option_ref);
    // constraint accumulation: child answers = parent answers + this ONE option, exactly.
    return { answers: { ...this._session.answersOf(parent), [o.axis_id]: o.value }, meta: { axis_id: o.axis_id, option_ref } };
  }

  /** PROBE an option by ref (evaluate, no edge). Returns the brain-facing handle (projection + counts). */
  probeByRef(parent, option_ref) { const { answers, meta } = this._answerFor(parent, option_ref); return this._session.probe(parent, answers, { meta }); }

  /** PUBLISH an option by ref (REFINE — mints the tree edge). Returns the child node. */
  publishByRef(parent, option_ref) { const { answers, meta } = this._answerFor(parent, option_ref); return this._session.refine(parent, answers, { meta }); }

  /** SERVER-ONLY passthroughs (the verifier/certifier use these; phase B does not). */
  verifyTree(nodes) { return this._session.verifyTree(nodes); }
  transcript() { return this._session.transcript(); }
  membersOf(ref) { return this._session.membersOf(ref); }
  answersOf(node) { return this._session.answersOf(node); }
  /** SERVER-ONLY: the qualified-option COUNT for an axis at a node (for re-running the counts-only rule). */
  optionCount(node, axisId) { const a = this._session.answersOf(node); return enumerateQualifiedOptions(this._units, this._constraints, a, axisId).length; }
  axisIds() { return this._constraints.map((c) => String(c.id)); }
  get calls() { return this._session.callCount; }
  get cacheHits() { return this._session.cacheHitCount; }
  get session() { return this._session; }
}

export default { AuthoringOracle };
