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
      order: c.order || undefined, resolved: c.resolved || undefined, role: c.role || undefined, direction: c.direction || undefined,
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

  /** SERVER-ONLY: is `unitId` GROUNDED on `axisId`? (roster-side; for drop-reason attribution). */
  _isGrounded(unitId, axisId) {
    const u = this._units.find((x) => String(x.id) === String(unitId));
    if (!u) return false;
    const g = u.values && (u.values.get ? u.values.get(axisId) : u.values[axisId]);
    if (g == null) return false;
    if (typeof g === "object" && !Array.isArray(g) && "value" in g) return g.value != null && g.grounded !== false;
    return true;
  }

  /**
   * SERVER-ONLY: u₀-REACHABILITY (round-5) + ELIGIBLE-DROP ACCOUNTING (round-6). For every INTERNAL node:
   *   • EXACT invariant (HARD): every parent-EXACT candidate must stay in some child's eligible pool. An
   *     exact candidate lost by branching is a dead-end (ق2) → the build FAILS. (RELAXABLE unknowns
   *     compromise into every child and are covered; only a NEVER_RELAX-ungrounded exact unit is lost.)
   *   • ELIGIBLE ledger (round-6): every parent-ELIGIBLE candidate (exact ∪ compromise) must stay eligible
   *     at ≥1 child OR be RECORDED in the drop ledger with a NAMED reason. An UNRECORDED drop → build FAILS.
   *     The only legitimate named reason here is `unknown_on_axis:<A>` (ungrounded on the chosen axis; a
   *     NEVER_RELAX axis then rejects it in every branch). A drop with no attributable reason is unrecorded.
   * Enforced here (roster-side) because the counts-only brain cannot see relax mode. `ok` ⇔ zero exact drops
   * AND zero unrecorded eligible drops. Recorded compromise drops are allowed (surfaced, never silent).
   */
  verifyReachability(nodes = []) {
    const byHash = new Map(nodes.map((n) => [n.evaluation_hash, n]));
    const kids = new Map();
    for (const n of nodes) { const ph = n.transition && n.transition.parent_hash; if (ph) (kids.get(ph) || kids.set(ph, []).get(ph)).push(n); }
    const findings = []; const recordedMap = new Map(); let internalChecked = 0, exactDrops = 0, unrecorded = 0;
    for (const [ph, cs] of kids) {
      const parent = byHash.get(ph); if (!parent) continue;
      internalChecked++;
      // the axis this node branched on = the single answer key present in a child but not the parent
      const pKeys = Object.keys(this.answersOf(parent));
      const childAxis = Object.keys(this.answersOf(cs[0])).find((k) => !pKeys.includes(k)) || "(unknown-axis)";
      const parentExact = new Set(this._session.membersOf(parent.pools.exact_ref));
      const parentElig = new Set(this._session.membersOf(parent.pools.eligible_ref));
      const covered = new Set(cs.flatMap((c) => this._session.membersOf(c.pools.eligible_ref)));
      const lostExact = [...parentExact].filter((x) => !covered.has(x));
      if (lostExact.length) { exactDrops += lostExact.length; findings.push({ node_hash: ph, axis: childAxis, lost_count: lostExact.length, lost: lostExact.slice(0, 8) }); }
      for (const x of parentElig) {
        if (covered.has(x)) continue;
        const reason = this._isGrounded(x, childAxis) ? "unrecorded" : `unknown_on_axis:${childAxis}`;
        if (reason === "unrecorded") unrecorded++;
        else recordedMap.set(reason, (recordedMap.get(reason) || 0) + 1);
      }
    }
    const recorded_drops = [...recordedMap.entries()].map(([reason, count]) => ({ reason, count }));
    return { ok: exactDrops === 0 && unrecorded === 0, findings, exact_drops: exactDrops, unrecorded_eligible_drops: unrecorded, recorded_drops, internalChecked };
  }

  /** SERVER-ONLY passthroughs (the verifier/certifier use these; phase B does not). */
  verifyTree(nodes) { return this._session.verifyTree(nodes); }
  transcript() { return this._session.transcript(); }
  membersOf(ref) { return this._session.membersOf(ref); }
  answersOf(node) { return this._session.answersOf(node); }
  /** SERVER-ONLY: the qualified-option COUNT for an axis at a node (for re-running the counts-only rule). */
  optionCount(node, axisId) { const a = this._session.answersOf(node); return enumerateQualifiedOptions(this._units, this._constraints, a, axisId).length; }
  axisIds() { return this._constraints.map((c) => String(c.id)); }
  // BRANCHABLE axes exclude a budget_ceiling ROLE (ق13): a ceiling does NOT partition the pool (a family
  // qualifies for every band ≤ its cheapest — overlapping sets), so it is a LEAF-LEVEL filter (variant ceiling,
  // ADR-0063 / brain's variant-level budget), never an info-gain branch. This is what keeps the partition
  // invariant (Σsᵢ+u₀=S) sound while the kernel matches the ceiling at certify-time.
  ceilingAxisIds() { return this._constraints.filter((c) => c.role === "budget_ceiling" || c.direction === "at_most").map((c) => String(c.id)); }
  branchableAxisIds() { const ceil = new Set(this.ceilingAxisIds()); return this.axisIds().filter((id) => !ceil.has(id)); }
  /**
   * SERVER-ONLY: the axis EVIDENCE DEGREE — how many units carry a GROUNDED value on the axis (a count,
   * never identities). This is the v4 tie-break signal (a better-evidenced axis wins an exact tie). It is a
   * property of the axis over the whole catalog, so it is node-independent and deterministic.
   */
  groundedCount(axisId) {
    let n = 0;
    for (const u of this._units) {
      const g = u && u.values && (u.values.get ? u.values.get(axisId) : u.values[axisId]);
      if (g == null) continue;
      if (typeof g === "object" && !Array.isArray(g) && "value" in g) { if (g.value != null && g.grounded !== false) n++; }
      else n++;
    }
    return n;
  }
  get calls() { return this._session.callCount; }
  get cacheHits() { return this._session.cacheHitCount; }
  get session() { return this._session; }
}

export default { AuthoringOracle };
