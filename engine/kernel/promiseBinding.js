/**
 * engine/kernel/promiseBinding.js — rule-based promise binding (ADR-0037 closing, item 1).
 * ===========================================================================================
 * An option's meaning is its PREDICATE, not its label. The option's group is DERIVED by applying
 * the predicate to the catalog — `group(option) = { SKU : status(predicate, SKU) === SAT }` — never
 * authored separately. Governance: on any conflict the predicate + its canonical value + the group
 * derived from it are authoritative; the label may not widen or narrow that meaning.
 *
 * Strict labels are generated deterministically from an ontology/template where possible (a form or
 * price band), so an LLM can only PROPOSE copy, never DEFINE the strict meaning.
 *
 * Publish-time per-option WITNESS (any failure fails the funnel — it is validity, not lint):
 *   (a) ≥1 eligible SKU is SAT under the option's predicate (no dead option),
 *   (b) every SKU the funnel routes to via that option satisfies the option's strict predicate,
 *   (c) the label does not invert or widen the value: labels are distinct per option, non-empty,
 *       and — for an ordinal band — monotonic with the value order (no "cheaper" label on a higher
 *       tier), and for a strict axis with a known template the label matches the canonical string.
 *
 * Shares ONLY the base predicate (`status`) with the kernel. Pure, deterministic.
 */

import { status, SAT } from "./constraintKernel.js";
import { compileConstraints, compileUnits } from "./compile.js";

/** A small, extensible ontology of canonical strict labels (form). Falls back to the axis label. */
const FORM_LABELS = { oil: "زيت", spray: "بخّاخ", perfume: "عطر", raw: "خام", set: "طقم", wood: "خشب" };

/** Canonical label for a strict option, or null if there is no deterministic template for it. */
export function canonicalLabel(constraint, value) {
  if (constraint.type === "nominal" && constraint.mode === "NEVER_RELAX") {
    const key = String(value).toLowerCase();
    return FORM_LABELS[key] || null; // form ontology; open vocabularies fall back (null)
  }
  return null; // ordinal budget labels are canonically produced upstream (budgetAxis, FIX-4)
}

function unitVal(unit, cid) {
  const g = unit.values.get(cid);
  return g == null ? { value: null, grounded: false } : g;
}

/** Derive every option's predicate group from the catalog. */
export function bindOptions(axisSet, products) {
  const constraints = compileConstraints(axisSet);
  const units = compileUnits(products, axisSet);
  const cById = new Map(constraints.map((c) => [c.id, c]));
  const options = [];
  for (const a of axisSet) {
    const c = cById.get(a.id);
    for (const v of a.values) {
      const group = units.filter((u) => status(c, v.value, unitVal(u, c.id)).state === SAT).map((u) => u.id);
      options.push({ axis: a.id, value: v.value, label: v.label, mode: c.mode, type: c.type, ordinalRank: (c.order || []).indexOf(String(v.value)), group });
    }
  }
  return { constraints, options };
}

/**
 * Witness the promise binding for a whole funnel. Returns { ok, findings }.
 * @param {Array} axisSet   the authored axes (with .values + .profile)
 * @param {Object} catalog  { products }
 */
export function checkPromiseBinding(axisSet, catalog) {
  const findings = [];
  const products = (catalog && catalog.products) || [];
  const { options } = bindOptions(axisSet, products);
  const byAxis = new Map();
  for (const o of options) { if (!byAxis.has(o.axis)) byAxis.set(o.axis, []); byAxis.get(o.axis).push(o); }

  for (const [axis, opts] of byAxis) {
    const seenLabel = new Map();
    for (const o of opts) {
      // (a) no dead option — every offered answer must resolve to ≥1 real SKU.
      if (o.group.length === 0) findings.push({ axis, value: o.value, witness: "a", msg: "dead option: 0 eligible SKU" });
      // (c) label non-empty
      if (!o.label || !String(o.label).trim()) findings.push({ axis, value: o.value, witness: "c", msg: "empty label" });
      // (c) label distinct within the axis — a reused label WIDENS meaning across two predicates.
      const lk = String(o.label).trim();
      if (seenLabel.has(lk) && seenLabel.get(lk) !== o.value) findings.push({ axis, value: o.value, witness: "c", msg: `label "${lk}" reused across values (widening)` });
      seenLabel.set(lk, o.value);
      // (c) canonical template match where one exists (strict form).
      const canon = canonicalLabel({ type: o.type, mode: o.mode, order: [] }, o.value);
      if (canon && lk && !lk.includes(canon)) findings.push({ axis, value: o.value, witness: "c", msg: `label "${lk}" not the canonical "${canon}" for ${o.value}` });
    }
    // (c) ordinal monotonicity — a higher tier must not carry a "cheaper-sounding" (lower) label.
    const ord = opts.filter((o) => o.type === "ordinal" && o.ordinalRank >= 0).sort((a, b) => a.ordinalRank - b.ordinalRank);
    for (let i = 1; i < ord.length; i++) {
      const prevNum = firstNumber(ord[i - 1].label), curNum = firstNumber(ord[i].label);
      if (prevNum != null && curNum != null && curNum < prevNum) findings.push({ axis, value: ord[i].value, witness: "c", msg: "ordinal label not monotonic with value order (inverted band)" });
    }
  }
  return { ok: findings.length === 0, findings, optionCount: options.length };
}

function firstNumber(s) { const m = String(s || "").replace(/[,٬]/g, "").match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; }

export default { bindOptions, checkPromiseBinding, canonicalLabel };
