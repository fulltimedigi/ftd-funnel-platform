/**
 * authoring/brain/axisRoles.js — Part-2 brain, BUILD STEP 3: axis_role derivation.
 * ---------------------------------------------------------------------------------------------
 * Assigns a decision ROLE to each PUBLISHED axis contract (Step 2), following the constitution's order:
 *   1. semantic PROPOSAL  — a hint from the axis's nature (grade + scope + ordinal).
 *   2. deterministic PREDICATE — a structural rule that DECIDES the role from the catalog shape.
 *   3. counterfactual VALIDATION — confirms the decision on the data (it VALIDATES, never DERIVES):
 *        • hard            → swap the value ⇒ land in a DISJOINT family set (mutually-exclusive category).
 *        • budget_ceiling  → bands are ORDINAL & monotonic (a higher band strictly costs more).
 *        • fit             → values CO-OCCUR inside one branch (a within-category refinement, not a
 *                            disguised category split). If no branch holds ≥2 values, fit is NOT validated.
 * Pure, deterministic, dependency-free. axis_role is set here and only here.
 */

function proposeRole(axis) {
  if (axis.scope === "catalog" && axis.ordinal) return "budget_ceiling"; // ordinal upper bound (ق13)
  if (axis.scope === "catalog") return "hard";                           // mutually-exclusive category (ق8)
  return "fit";                                                          // within-category refinement (ق9)
}

function validateHard(axis) {
  // mutual exclusivity: no family appears under two values
  const seen = new Set(); let overlaps = 0;
  for (const v of axis.values) for (const fid of v.families) { if (seen.has(fid)) overlaps++; else seen.add(fid); }
  const validated = overlaps === 0 && axis.values.length >= 2;
  return { test: "mutual_exclusivity", values: axis.values.length, overlaps, validated };
}

function validateCeiling(axis, priceOf) {
  const order = ["low", "mid", "high"];
  const avg = (v) => { const ps = (v.families || []).map(priceOf).filter((n) => n != null); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null; };
  const byVal = new Map(axis.values.map((v) => [v.value, avg(v)]));
  const seq = order.map((k) => byVal.get(k)).filter((n) => n != null);
  let monotonic = seq.length >= 2;
  for (let i = 1; i < seq.length; i++) if (!(seq[i] > seq[i - 1])) monotonic = false;
  return { test: "ordinal_monotonic", order, band_avg: Object.fromEntries(byVal), validated: monotonic };
}

function validateFit(axis) {
  const bv = (axis.applicability && axis.applicability.branch_values) || {};
  const cooccur = Object.entries(bv).filter(([, vals]) => (vals || []).length >= 2).map(([b]) => b);
  return { test: "within_branch_cooccurrence", branches_with_multiple_values: cooccur, validated: cooccur.length > 0 };
}

export function assignAxisRoles(published = [], familyMatrix = []) {
  const priceOf = (() => {
    const m = new Map(familyMatrix.map((f) => [f.family_id, (f.prices || [])[0] ?? null]));
    return (fid) => m.get(fid) ?? null;
  })();
  return published.map((axis) => {
    const proposed = proposeRole(axis);
    const counterfactual =
      proposed === "hard" ? validateHard(axis) :
      proposed === "budget_ceiling" ? validateCeiling(axis, priceOf) :
      validateFit(axis);
    return { ...axis, proposed_role: proposed, axis_role: proposed, role_validated: counterfactual.validated, counterfactual };
  });
}
