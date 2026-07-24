/**
 * engine/kernel/constraintKernel.js — THE CONSTRAINT KERNEL (ADR-0037, Promise Principle v3).
 * ===========================================================================================
 * The SINGLE SOURCE OF TRUTH for what "matches" means (Guardrail G1). Every decision — in
 * authoring (materializing the decision table) and at runtime (re-verifying the served SKU) —
 * flows through THIS module. The decision table is a *materialized cache* the kernel generates;
 * it carries no independent matching logic. Nothing renders a recommendation without a
 * `SelectionResult` minted by the one constructor here, and that constructor demands a passing
 * verification certificate (Guardrail G2).
 *
 * Design (no heavy solver dep): constraint-based recommendation (Felfernig) + constraint
 * hierarchies (Borning) + lexicographic / partial CSP + minimal-correction-set explanation.
 * Pure, deterministic, dependency-free, Node- and browser-safe.
 *
 * ── The three-valued core ──────────────────────────────────────────────────────────────────
 *   status(constraint, answer, unitValue) → { state: SAT | VIOLATED | UNKNOWN, magnitude }
 *   • The answer compiles to a TYPED PREDICATE (not label-equality).
 *   • An ungrounded / missing unit value is UNKNOWN — NEVER silently treated as a match.
 *
 * ── Selection (lexicographic partial-CSP) ──────────────────────────────────────────────────
 *   1. Exclude any unit where a NEVER_RELAX constraint is VIOLATED or UNKNOWN.
 *   2. For each survivor build a loss vector:
 *        < (viol@prio0, mag@prio0), (viol@prio1, mag@prio1), …, unknownPenalty, advisoryLoss, tie >
 *   3. Pick the lexicographically smallest. Coverage is a TIE-BREAK ONLY (equal-loss only).
 *   4. If any EXACT candidate exists, a COMPROMISE candidate may not win (exact dominance) —
 *      guaranteed by the vector (an EXACT unit's leading cells are all zero).
 *   5. Relaxation BOUNDS (max budget overshoot, never relax safety, no UNKNOWN on an asserted
 *      match) — past a bound the result is the first-class "no exact match" state, not a
 *      confident card with a footnote.
 *
 * ── Disclosure ─────────────────────────────────────────────────────────────────────────────
 *   Computed by RE-COMPARING the chosen unit to every answer afresh (not from the constraints
 *   the search happened to drop). Conflicts (VIOLATED) and relevant unknowns are distinct.
 */

export const SAT = "SAT";
export const VIOLATED = "VIOLATED";
export const UNKNOWN = "UNKNOWN";

export const NEVER_RELAX = "NEVER_RELAX";
export const RELAXABLE = "RELAXABLE";
export const ADVISORY = "ADVISORY";

export const EXACT = "EXACT";
export const COMPROMISE = "COMPROMISE";
export const UNVERIFIED = "UNVERIFIED";
export const NO_MATCH = "NO_MATCH";

const asSet = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x));

/**
 * Grounded value of a unit on a constraint.
 *   { value, grounded } — `value` may itself be a set (nominal). `grounded=false` or a
 *   null/absent value means the kernel genuinely can't tell → UNKNOWN. Provenance ranking
 *   (structured field > merchant map > deterministic ontology > validated extraction >
 *   uncorroborated inference) is decided UPSTREAM (grounding.js); the kernel only trusts the
 *   `grounded` flag: token-presence alone must arrive here as grounded=false.
 */
function unitValue(unit, constraint) {
  const g = unit.values && unit.values.get ? unit.values.get(constraint.id) : (unit.values || {})[constraint.id];
  if (g == null) return { value: null, grounded: false };
  if (typeof g === "object" && !Array.isArray(g) && "value" in g) return { value: g.value, grounded: g.grounded !== false };
  return { value: g, grounded: true };
}

/** rank of an ordered value in an ordinal / price-tier constraint (−1 if unknown). */
function rankOf(constraint, value) {
  const order = constraint.order || [];
  return order.indexOf(String(value));
}

/**
 * THE typed three-valued predicate. `answer` is what the shopper picked on this constraint;
 * `uv` is unitValue(unit, constraint). Returns { state, magnitude } (magnitude 0 unless VIOLATED).
 */
export function status(constraint, answer, uv) {
  if (answer == null) return { state: SAT, magnitude: 0 }; // constraint not asked on this path → vacuous
  if (uv == null || uv.value == null || uv.grounded === false) return { state: UNKNOWN, magnitude: 0 };

  switch (constraint.type) {
    case "nominal": {
      const want = new Set(asSet(answer));
      const have = asSet(uv.value);
      const hit = have.some((v) => want.has(v));
      return hit ? { state: SAT, magnitude: 0 } : { state: VIOLATED, magnitude: 1 };
    }
    case "taxonomy": {
      // requested is ancestor-or-equal of the unit's value: "spray perfume" ⊇ EDP/EDT.
      const want = String(answer);
      const have = asSet(uv.value);
      const desc = (constraint.descendants && constraint.descendants[want]) || [want];
      const set = new Set(desc.map(String));
      const hit = have.some((v) => set.has(String(v)) || String(v) === want);
      return hit ? { state: SAT, magnitude: 0 } : { state: VIOLATED, magnitude: 1 };
    }
    case "ordinal": {
      const ra = rankOf(constraint, answer), rv = rankOf(constraint, uv.value);
      if (ra < 0 || rv < 0) return { state: UNKNOWN, magnitude: 0 };
      return ra === rv ? { state: SAT, magnitude: 0 } : { state: VIOLATED, magnitude: Math.abs(ra - rv) };
    }
    case "price": {
      // DIRECTIONAL numeric. answer = { cap } for "≤ cap" (or { min } for "≥ min"). Under-budget
      // is strictly cheaper (distance 0 when within), over-budget grows with the overshoot —
      // under and over are NEVER equal.
      const price = Number(uv.value);
      if (!Number.isFinite(price)) return { state: UNKNOWN, magnitude: 0 };
      const cap = answer && answer.cap != null ? Number(answer.cap) : null;
      const min = answer && answer.min != null ? Number(answer.min) : null;
      let over = 0;
      if (cap != null && price > cap) over += price - cap;
      if (min != null && price < min) over += min - price;
      return over > 0 ? { state: VIOLATED, magnitude: over } : { state: SAT, magnitude: 0 };
    }
    default: {
      // fallback: strict equality on stringified value
      return String(uv.value) === String(answer) ? { state: SAT, magnitude: 0 } : { state: VIOLATED, magnitude: 1 };
    }
  }
}

/** Per-unit status map: constraint.id → { state, magnitude }. Variant-aware (best variant). */
export function evaluateUnit(unit, constraints, answers) {
  const perC = {};
  for (const c of constraints) {
    const a = answers[c.id];
    if (c.type === "variant") { perC[c.id] = variantStatus(unit, c, a); continue; }
    perC[c.id] = status(c, a, unitValue(unit, c));
  }
  return perC;
}

/**
 * variant/SKU predicate: SAT only if ≥1 PURCHASABLE variant satisfies the variant-level answer
 * (match the buyable SKU, not the product shell). Chooses that variant. `answer` = required
 * variant attributes {attr: value}. Returns { state, magnitude, variantId }.
 */
function variantStatus(unit, constraint, answer) {
  const variants = (unit.variants || []).filter((v) => v && v.purchasable !== false);
  if (!variants.length) {
    // No variant data: a single-SKU product is its own buyable unit.
    return { state: answer == null ? SAT : UNKNOWN, magnitude: 0, variantId: unit.variantId || null };
  }
  if (answer == null) return { state: SAT, magnitude: 0, variantId: variants[0].id };
  const want = Object.entries(answer);
  const ok = variants.find((v) => want.every(([k, val]) => String((v.attributes || {})[k]) === String(val)));
  return ok ? { state: SAT, magnitude: 0, variantId: ok.id } : { state: VIOLATED, magnitude: 1, variantId: null };
}

/**
 * Loss vector for lexicographic comparison. Groups violations by relaxation_priority (0 = most
 * important), then unknown penalty, then advisory loss, then the caller's stable tie-break.
 * NEVER_RELAX violations/unknowns are handled by exclusion BEFORE this — they never reach here.
 */
function lossVector(unit, constraints, perC, tieBreakValue) {
  const prios = [...new Set(constraints.map((c) => c.priority || 0))].sort((a, b) => a - b);
  const byPrio = prios.map((p) => {
    let viol = 0, mag = 0;
    for (const c of constraints) {
      if ((c.priority || 0) !== p) continue;
      if (c.mode === ADVISORY) continue; // advisory handled separately
      const s = perC[c.id];
      if (s.state === VIOLATED) { viol++; mag += s.magnitude; }
    }
    return [viol, mag];
  });
  let unknownPenalty = 0, advisoryLoss = 0;
  for (const c of constraints) {
    const s = perC[c.id];
    if (c.mode === ADVISORY) { if (s.state === VIOLATED) advisoryLoss += 1 + s.magnitude; continue; }
    if (s.state === UNKNOWN) unknownPenalty++;
  }
  return { byPrio, unknownPenalty, advisoryLoss, tie: tieBreakValue };
}

/** Lexicographic compare of two loss vectors: <0 if a is better (smaller loss). */
function compareLoss(a, b) {
  const n = Math.max(a.byPrio.length, b.byPrio.length);
  for (let i = 0; i < n; i++) {
    const [av, am] = a.byPrio[i] || [0, 0];
    const [bv, bm] = b.byPrio[i] || [0, 0];
    if (av !== bv) return av - bv;
    if (am !== bm) return am - bm;
  }
  if (a.unknownPenalty !== b.unknownPenalty) return a.unknownPenalty - b.unknownPenalty;
  if (a.advisoryLoss !== b.advisoryLoss) return a.advisoryLoss - b.advisoryLoss;
  return (a.tie ?? 0) - (b.tie ?? 0);
}

/** EXACT (all asked SAT) / COMPROMISE (≥1 VIOLATED) / UNVERIFIED (no VIOLATED, ≥1 relevant UNKNOWN). */
function matchState(constraints, perC) {
  let violated = false, unknown = false;
  for (const c of constraints) {
    const s = perC[c.id];
    if (s.state === VIOLATED) violated = true;
    else if (s.state === UNKNOWN && c.mode !== ADVISORY) unknown = true;
  }
  if (violated) return COMPROMISE;
  if (unknown) return UNVERIFIED;
  return EXACT;
}

/**
 * Disclosure — re-compare the CHOSEN unit to every answer afresh (spec: NOT from the constraints
 * the search dropped). Returns { matches[], conflicts[], unknowns[] } with typed entries the
 * renderer consumes structurally (never as pre-authored prose).
 */
export function disclose(unit, constraints, answers, perC) {
  const matches = [], conflicts = [], unknowns = [];
  for (const c of constraints) {
    if (answers[c.id] == null) continue; // not asked on this path
    const s = perC[c.id] || status(c, answers[c.id], unitValue(unit, c));
    const base = { axis: c.id, label: c.label || c.id, mode: c.mode, priority: c.priority || 0 };
    if (s.state === SAT) matches.push(base);
    else if (s.state === VIOLATED) {
      const o = { ...base, magnitude: s.magnitude };
      if (c.type === "ordinal") { const d = direction(c, answers[c.id], unitValue(unit, c)); if (d) o.dir = d; }
      if (c.type === "price") o.dir = "above"; // over-cap is the only VIOLATED direction here
      if (c.mode === ADVISORY || (c.mode !== NEVER_RELAX && !c.strict)) o.soft = true;
      conflicts.push(o);
    } else unknowns.push(base);
  }
  return { matches, conflicts, unknowns };
}

function direction(constraint, answer, uv) {
  const ra = rankOf(constraint, answer), rv = rankOf(constraint, uv && uv.value);
  if (ra < 0 || rv < 0 || ra === rv) return undefined;
  return rv > ra ? "above" : "below";
}

/**
 * THE ONE SelectionResult constructor. It DEMANDS a passing certificate — there is no other way
 * to mint a renderable result (No-bypass rule). `product_id === null` is the honest first-class
 * "no exact match" (NO_MATCH) state and is allowed.
 */
function makeSelectionResult(cert, fields) {
  if (!cert || cert.ok !== true) {
    throw new Error("SelectionResult refused: verification certificate not satisfied — " + ((cert && cert.reasons) || []).join("; "));
  }
  return Object.freeze({
    product_id: fields.product_id ?? null,
    variant_id: fields.variant_id ?? null,
    catalog_version: fields.catalog_version ?? null,
    policy_version: fields.policy_version ?? null,
    match_state: fields.match_state,
    matches: fields.matches || [],
    conflicts: fields.conflicts || [],
    unknowns: fields.unknowns || [],
    tie_break_reason: fields.tie_break_reason || null,
  });
}

/** Default relaxation bounds. Merchant-overridable via opts.bounds. */
const DEFAULT_BOUNDS = {
  maxBudgetOvershootTiers: 1, // an ordinal budget may relax at most one tier
  noUnknownOnAssertedMatch: true,
};

/**
 * verify() — the certificate. Re-derives the chosen unit's status from scratch and asserts the
 * exit invariants for THIS selection (criteria 1–4). Returns { ok, reasons }.
 */
export function verify(chosen, constraints, answers, ctx) {
  const reasons = [];
  if (chosen == null) return { ok: true, reasons }; // NO_MATCH is a valid, honest result
  // (1) product & (variant) exist in the served catalog
  if (ctx && ctx.catalogUrls && !ctx.catalogUrls.has(chosen.id)) reasons.push(`unit ${chosen.id} not in served catalog`);
  const perC = evaluateUnit(chosen, constraints, answers);
  // (2) every NEVER_RELAX = SAT
  for (const c of constraints) {
    if (c.mode !== NEVER_RELAX) continue;
    const s = perC[c.id];
    if (s.state !== SAT) reasons.push(`NEVER_RELAX "${c.id}" is ${s.state} on chosen unit`);
  }
  return { ok: reasons.length === 0, reasons, perC };
}

/**
 * select() — the whole kernel decision for ONE answer-path. Deterministic.
 * @param {Array} units       recommendable units (product shells; may carry .variants)
 * @param {Array} constraints typed constraints (see compileConstraints upstream)
 * @param {Object} answers    constraintId → answer (value | set | {cap} | {attr:val})
 * @param {Object} opts       { catalogVersion, policyVersion, bounds, tieBreak(unit,perC)->number, catalogUrls }
 * @returns {SelectionResult}
 */
export function select(units, constraints, answers, opts = {}) {
  const bounds = { ...DEFAULT_BOUNDS, ...(opts.bounds || {}) };
  const tieBreak = opts.tieBreak || (() => 0);

  // 1. exclude NEVER_RELAX VIOLATED or UNKNOWN
  const survivors = [];
  for (const u of units) {
    const perC = evaluateUnit(u, constraints, answers);
    let ok = true;
    for (const c of constraints) {
      if (c.mode !== NEVER_RELAX) continue;
      if (perC[c.id].state !== SAT) { ok = false; break; }
    }
    if (ok) survivors.push({ u, perC });
  }

  if (!survivors.length) {
    const cert = verify(null, constraints, answers, opts);
    return makeSelectionResult(cert, {
      product_id: null, match_state: NO_MATCH,
      catalog_version: opts.catalogVersion || null, policy_version: opts.policyVersion || null,
      tie_break_reason: "no unit satisfies the never-relax constraints",
    });
  }

  // 2–3. lexicographic-min loss
  let best = null, bestLoss = null;
  for (const s of survivors) {
    const loss = lossVector(s.u, constraints, s.perC, tieBreak(s.u, s.perC));
    if (!best || compareLoss(loss, bestLoss) < 0) { best = s; bestLoss = loss; }
  }

  // 4. exact dominance — an EXACT candidate must beat any COMPROMISE (the vector already
  //    guarantees it; assert to make the invariant a hard failure, not a silent regression).
  const anyExact = survivors.some((s) => matchState(constraints, s.perC) === EXACT);
  const bestState = matchState(constraints, best.perC);
  if (anyExact && bestState !== EXACT) {
    throw new Error("kernel invariant broken: an EXACT candidate exists but a COMPROMISE was selected");
  }

  // 5. relaxation bounds → first-class NO_MATCH beyond a bound
  const boundBreak = beyondBounds(best.u, constraints, best.perC, bounds);
  const chosen = boundBreak ? null : best.u;
  const state = boundBreak ? NO_MATCH : bestState;

  const cert = verify(chosen, constraints, answers, opts);
  const disc = chosen ? disclose(chosen, constraints, answers, best.perC) : { matches: [], conflicts: [], unknowns: [] };
  return makeSelectionResult(cert, {
    product_id: chosen ? chosen.id : null,
    variant_id: chosen ? chosenVariant(chosen, constraints, best.perC) : null,
    catalog_version: opts.catalogVersion || null,
    policy_version: opts.policyVersion || null,
    match_state: state,
    matches: disc.matches, conflicts: disc.conflicts, unknowns: disc.unknowns,
    tie_break_reason: boundBreak || tieReason(bestLoss, disc),
  });
}

function chosenVariant(unit, constraints, perC) {
  for (const c of constraints) if (c.type === "variant" && perC[c.id] && perC[c.id].variantId) return perC[c.id].variantId;
  return unit.variantId || null;
}

function beyondBounds(unit, constraints, perC, bounds) {
  for (const c of constraints) {
    const s = perC[c.id];
    if (s.state !== VIOLATED) continue;
    if (c.type === "ordinal" && c.mode === RELAXABLE && bounds.maxBudgetOvershootTiers != null) {
      if (s.magnitude > bounds.maxBudgetOvershootTiers) return `budget overshoot ${s.magnitude} tiers > bound ${bounds.maxBudgetOvershootTiers}`;
    }
  }
  return null;
}

function tieReason(loss, disc) {
  if (disc.conflicts.length) return "closest available on the relaxed constraints";
  if (disc.unknowns.length) return "best grounded match; some attributes unverified";
  return "exact match";
}

export default {
  SAT, VIOLATED, UNKNOWN, NEVER_RELAX, RELAXABLE, ADVISORY, EXACT, COMPROMISE, UNVERIFIED, NO_MATCH,
  status, evaluateUnit, disclose, select, verify,
};
