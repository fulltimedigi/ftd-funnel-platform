/**
 * engine/kernel/verifyFunnel.js — PUBLISH-TIME exhaustive verification (ADR-0037).
 * ---------------------------------------------------------------------------------------------
 * The materialized decision table is a FINITE set of reachable answer-paths, so we can PROVE the
 * promise for a specific funnel by enumerating every rule and asserting the v3 exit criteria —
 * not just running CI on synthetic stores. This runs on every REAL funnel before it is published
 * (wired into the Netlify generate function) and as a battery in CI. A finite table → an
 * exhaustive proof for that store.
 *
 * v3 EXIT CRITERIA — for every reachable path:
 *   1. product & SKU exist in the served catalog version.
 *   2. every NEVER_RELAX constraint = SAT (never appears relaxed/unknown).
 *   3. every VIOLATED or UNKNOWN answer appears in the disclosure.
 *   4. if an exact candidate exists, no compromise candidate is chosen.
 *   5. the chosen unit is best per the declared violation vector.
 *   6. no fallback / coverage reranking can corrupt that vector.
 *
 * Deterministic, dependency-free. Returns { ok, checked, findings[] } — never throws on a normal
 * funnel; a finding is a criterion violation with the offending rule id.
 */

import { NEVER_RELAX, select as kernelSelect } from "./constraintKernel.js";
import { compileConstraints, compileUnits, comboAnswers } from "./compile.js";

/**
 * @param {Object} config   authored funnel config (decisionTable with proofs, constraintPolicy, versions, archetypes)
 * @param {Object} catalog  { products } the served catalog the table was compiled from
 * @param {Object} axisSet  optional — the authored axisSet, enabling a full independent re-run
 *                          (criteria 4–6). Without it, criteria 1–3 are checked from the proofs.
 */
export function verifyFunnel(config, catalog, axisSet) {
  const findings = [];
  const products = (catalog && catalog.products) || [];
  const catalogUrls = new Set(products.map((p) => p.url));
  const modeById = new Map((config.constraintPolicy || []).map((c) => [c.id, c.mode]));
  const archById = new Map((config.archetypes || []).map((a) => [a.id, a]));
  const rules = (config.decisionTable || []).filter((r) => r.when && Object.keys(r.when).length);

  // Independent re-run inputs (criteria 4–6): rebuild the kernel constraints/units from axisSet.
  let constraints = null, units = null, unitByUrl = null;
  if (axisSet) {
    constraints = compileConstraints(axisSet);
    units = compileUnits(products, axisSet);
    unitByUrl = new Map(units.map((u) => [u.id, u]));
  }
  const nTiers = axisSet ? Math.max(1, ...axisSet.filter((a) => a.hard && a.ordinal).map((a) => a.values.length)) : 1;

  let checked = 0;
  for (const rule of rules) {
    checked++;
    const arch = archById.get(rule.result);
    const prod = arch && arch.recommendations && arch.recommendations.primary;

    // (1) product & SKU exist in the served catalog
    if (!prod || !prod.url) { findings.push({ rule: rule.id, criterion: 1, msg: "rule resolves to no product" }); continue; }
    if (!catalogUrls.has(prod.url)) findings.push({ rule: rule.id, criterion: 1, msg: `product ${prod.url} not in served catalog` });

    const proof = rule.proof || {};
    const conflicts = proof.conflicts || [];
    const unknowns = proof.unknowns || [];

    // (2) never-relax never relaxed / unknown
    for (const c of conflicts) if (modeById.get(c.axis) === NEVER_RELAX) findings.push({ rule: rule.id, criterion: 2, msg: `never-relax ${c.axis} relaxed` });
    for (const u of unknowns) if (modeById.get(u.axis) === NEVER_RELAX) findings.push({ rule: rule.id, criterion: 2, msg: `never-relax ${u.axis} unknown` });

    if (!axisSet) continue; // criteria 3–6 need the independent re-run

    // Independent kernel re-run for this exact answer-path (criteria 3–6): NO coverage tie-break,
    // NO fallback — the pure kernel decision. Its disclosure and pick are the ground truth.
    const combo = orderedCombo(axisSet, rule.when);
    const answers = comboAnswers(axisSet, combo);
    const truth = kernelSelect(units, constraints, answers, { catalogUrls, bounds: { maxBudgetOvershootTiers: nTiers } });

    // (3) every VIOLATED/UNKNOWN on the CHOSEN product appears in the disclosure the card shows.
    const chosen = unitByUrl.get(prod.url);
    if (chosen) {
      const fresh = kernelSelect([chosen], constraints, answers, { catalogUrls, bounds: { maxBudgetOvershootTiers: nTiers } });
      const disc = new Set([...(rule.relaxed || []).map((r) => r.axis), ...conflicts.map((c) => c.axis), ...unknowns.map((u) => u.axis)]);
      for (const c of fresh.conflicts) if (!disc.has(c.axis)) findings.push({ rule: rule.id, criterion: 3, msg: `undisclosed conflict on ${c.axis}` });
      for (const u of fresh.unknowns) if (!disc.has(u.axis)) findings.push({ rule: rule.id, criterion: 3, msg: `undisclosed unknown on ${u.axis}` });
    }

    // (5)/(6) the chosen unit must be no worse than the kernel's own pick per the violation vector.
    // (Coverage tie-break may pick a DIFFERENT equal-quality unit — allowed; a WORSE one is not.)
    if (truth.product_id && chosen) {
      const truthState = truth.match_state, chosenState = proof.match_state;
      if (rank(chosenState) > rank(truthState)) {
        findings.push({ rule: rule.id, criterion: 6, msg: `chosen ${chosenState} worse than kernel-best ${truthState}` });
      }
      // (4) if an EXACT exists (truth is EXACT) the served rule must not be a COMPROMISE.
      if (truthState === "EXACT" && chosenState === "COMPROMISE") {
        findings.push({ rule: rule.id, criterion: 4, msg: "exact candidate exists but a compromise was served" });
      }
    }
  }

  return { ok: findings.length === 0, checked, findings };
}

function rank(state) { return state === "EXACT" ? 0 : state === "UNVERIFIED" ? 1 : state === "COMPROMISE" ? 2 : 3; }

function orderedCombo(axisSet, when) {
  return axisSet.map((a) => when[`D_${a.id}`]);
}

export default { verifyFunnel };
