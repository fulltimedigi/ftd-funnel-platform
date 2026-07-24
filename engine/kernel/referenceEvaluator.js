/**
 * engine/kernel/referenceEvaluator.js — an INDEPENDENT reference oracle for the kernel's decision
 * (ADR-0037 closing, BLOCKER-1 / C11).
 * ===========================================================================================
 * This module PROVES a claimed selection is optimal WITHOUT trusting the kernel's own chooser.
 * It shares ONLY the base three-valued predicates (`status` / `evaluateUnit`) — the definition of
 * SAT/VIOLATED/UNKNOWN, which must be common ground. It deliberately DOES NOT import — and
 * re-implements from scratch — the winner selection: eligibility, the loss representation, the
 * comparator, exact-dominance, and the tie-break. So `verifyFunnel` checking a table with this
 * oracle is a genuine second opinion, not the kernel grading its own homework.
 *
 * It brute-forces every eligible SKU and asserts, against the DECLARED policy:
 *   • the claimed unit is eligible (never-relax SAT, require-proof not UNKNOWN, no over-cap);
 *   • NO eligible unit is strictly better (lexicographic optimality);
 *   • exact-dominance: if any eligible unit is EXACT, the claimed unit is EXACT;
 *   • disclosure SOUNDNESS (every listed conflict/unknown is real) and COMPLETENESS (every real
 *     VIOLATED/UNKNOWN on the claimed unit is listed);
 *   • variant validity: the claimed SKU satisfies the variant constraints jointly.
 *
 * Independent comparator note: the policy it encodes (UNKNOWN scored within its own priority; a
 * bounded known violation beats an UNKNOWN) is the SAME declared policy as the kernel — but the
 * code below is a separate implementation. Two independent implementations agreeing IS the proof;
 * an injection test (tests/kernel.reference.test.mjs) deliberately feeds a wrong-ordering chooser
 * and asserts this oracle flags the disagreement, so the independence is tested, not merely claimed.
 */

import { status, evaluateUnit, SAT, VIOLATED, UNKNOWN, NEVER_RELAX, RELAXABLE, ADVISORY } from "./constraintKernel.js";

/** Independent eligibility — re-derived, not imported. */
function isEligible(constraints, perC, bounds) {
  for (const c of constraints) {
    const s = perC[c.id];
    if (c.mode === NEVER_RELAX && s.state !== SAT) return false;
    if (c.requireProof && s.state === UNKNOWN) return false;
    if (c.mode === RELAXABLE && s.state === VIOLATED) {
      if (c.type === "ordinal" && bounds.maxBudgetOvershootTiers != null && s.magnitude > bounds.maxBudgetOvershootTiers) return false;
      if (c.type === "price" && bounds.maxPriceOvershoot != null && s.magnitude > bounds.maxPriceOvershoot) return false;
    }
  }
  return true;
}

/** Independent loss representation: for each priority (ascending), a pair [unknownCount, magSum]. */
function independentLoss(constraints, perC) {
  const prioritySet = Array.from(new Set(constraints.filter((c) => c.mode !== ADVISORY).map((c) => c.priority || 0))).sort((x, y) => x - y);
  const cells = [];
  for (const p of prioritySet) {
    let u = 0, m = 0;
    for (const c of constraints) {
      if ((c.priority || 0) !== p || c.mode === ADVISORY) continue;
      const s = perC[c.id];
      if (s.state === UNKNOWN) u += 1;
      else if (s.state === VIOLATED) m += s.magnitude;
    }
    cells.push([u, m]);
  }
  let adv = 0;
  for (const c of constraints) {
    if (c.mode !== ADVISORY) continue;
    const s = perC[c.id];
    if (s.state === VIOLATED) adv += 1 + s.magnitude; else if (s.state === UNKNOWN) adv += 1;
  }
  return { cells, adv };
}

/** Independent strict-better test: returns true iff A is strictly better than B (smaller loss). */
function strictlyBetter(a, b) {
  const n = Math.max(a.cells.length, b.cells.length);
  for (let i = 0; i < n; i++) {
    const [au, am] = a.cells[i] || [0, 0];
    const [bu, bm] = b.cells[i] || [0, 0];
    if (au !== bu) return au < bu;
    if (am !== bm) return am < bm;
  }
  if (a.adv !== b.adv) return a.adv < b.adv;
  return false; // equal → not strictly better (ties are allowed; coverage may pick either)
}

/** Independent match-state. */
function stateOf(constraints, perC) {
  let violated = false, unknown = false;
  for (const c of constraints) {
    const s = perC[c.id];
    if (s.state === VIOLATED) violated = true;
    else if (s.state === UNKNOWN && c.mode !== ADVISORY) unknown = true;
  }
  return violated ? "COMPROMISE" : unknown ? "UNVERIFIED" : "EXACT";
}

/**
 * Prove a claimed selection against the whole eligible pool.
 * @param {Array} units        all recommendable units (with .values, optional .variants)
 * @param {Array} constraints  typed constraints
 * @param {Object} answers     constraintId → answer
 * @param {Object} claimed     { product_id, variant_id, match_state, conflicts[], unknowns[] }
 * @param {Object} bounds      relaxation bounds
 * @returns {{ ok:boolean, findings:Array<{criterion:number,msg:string}> }}
 */
export function proveSelection(units, constraints, answers, claimed, bounds = {}) {
  const findings = [];
  const add = (criterion, msg) => findings.push({ criterion, msg });
  const byId = new Map(units.map((u) => [u.id, u]));

  const eligible = units.filter((u) => isEligible(constraints, evaluateUnit(u, constraints, answers), bounds));

  if (claimed.product_id == null) {
    // A NoExactMatch claim is only valid if there truly is no eligible unit.
    if (eligible.length) add(6, `claimed NoExactMatch but ${eligible.length} eligible unit(s) exist`);
    return { ok: findings.length === 0, findings };
  }

  const chosen = byId.get(claimed.product_id);
  if (!chosen) { add(1, `claimed product ${claimed.product_id} is not a unit`); return { ok: false, findings }; }
  const chosenPerC = evaluateUnit(chosen, constraints, answers);
  if (!isEligible(constraints, chosenPerC, bounds)) add(2, `claimed product ${claimed.product_id} is INELIGIBLE (never-relax/require-proof/over-cap)`);

  const chosenLoss = independentLoss(constraints, chosenPerC);

  // (5)/(6) lexicographic optimality: no eligible unit is strictly better.
  let anyExact = false;
  for (const u of eligible) {
    const perC = evaluateUnit(u, constraints, answers);
    if (stateOf(constraints, perC) === "EXACT") anyExact = true;
    if (strictlyBetter(independentLoss(constraints, perC), chosenLoss)) {
      add(5, `unit ${u.id} is strictly better than the chosen ${claimed.product_id}`);
    }
  }

  // (4) exact dominance.
  const chosenState = stateOf(constraints, chosenPerC);
  if (anyExact && chosenState !== "EXACT") add(4, `an EXACT candidate exists but chosen is ${chosenState}`);
  if (claimed.match_state && claimed.match_state !== chosenState) add(4, `claimed match_state ${claimed.match_state} ≠ independently computed ${chosenState}`);

  // (3) disclosure soundness + completeness — recompute status of the chosen unit vs every answer.
  const listed = new Set([...(claimed.conflicts || []).map((c) => `V:${c.axis}`), ...(claimed.unknowns || []).map((u) => `U:${u.axis}`)]);
  for (const c of constraints) {
    if (answers[c.id] == null) continue;
    const s = c.type === "variant" ? chosenPerC[c.id] : status(c, answers[c.id], readVal(chosen, c));
    if (s.state === VIOLATED && !listed.has(`V:${c.id}`)) add(3, `undisclosed conflict on ${c.id}`);
    if (s.state === UNKNOWN && c.mode !== ADVISORY && !listed.has(`U:${c.id}`)) add(3, `undisclosed unknown on ${c.id}`);
  }
  // soundness: nothing listed that isn't actually VIOLATED / UNKNOWN.
  for (const c of claimed.conflicts || []) {
    const cc = constraints.find((x) => x.id === c.axis);
    if (cc && status(cc, answers[cc.id], readVal(chosen, cc)).state !== VIOLATED) add(3, `spurious conflict listed on ${c.axis}`);
  }
  for (const u of claimed.unknowns || []) {
    const cc = constraints.find((x) => x.id === u.axis);
    if (cc && status(cc, answers[cc.id], readVal(chosen, cc)).state !== UNKNOWN) add(3, `spurious unknown listed on ${u.axis}`);
  }

  // (7) variant validity: the claimed SKU must satisfy the variant constraints jointly.
  for (const c of constraints) {
    if (c.type !== "variant") continue;
    const st = chosenPerC[c.id];
    if (answers[c.id] != null && st.state !== SAT) add(7, `variant constraint ${c.id} not satisfied by claimed SKU`);
    if (claimed.variant_id && st.variantId && claimed.variant_id !== st.variantId) add(7, `claimed variant ${claimed.variant_id} ≠ satisfying SKU ${st.variantId}`);
  }

  return { ok: findings.length === 0, findings };
}

/** Read a unit's grounded value on a constraint (mirrors the kernel's unitValue, base-level only). */
function readVal(unit, constraint) {
  const g = unit.values && unit.values.get ? unit.values.get(constraint.id) : (unit.values || {})[constraint.id];
  if (g == null) return { value: null, grounded: false };
  if (typeof g === "object" && !Array.isArray(g) && "value" in g) return { value: g.value, grounded: g.grounded !== false };
  return { value: g, grounded: true };
}

export default { proveSelection };
