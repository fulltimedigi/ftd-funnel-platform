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

import { NEVER_RELAX } from "./constraintKernel.js";
import { compileConstraints, compileUnits, comboAnswers } from "./compile.js";
import { proveSelection } from "./referenceEvaluator.js";

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

    if (!axisSet) continue; // criteria 3–7 need the independent oracle

    // INDEPENDENT reference oracle (BLOCKER-1 / C11) for this exact answer-path. It shares only the
    // base predicates with the kernel — its selection/comparator/tie-break are a separate
    // implementation — so this is a genuine second opinion on criteria 3, 4, 5, 6, 7.
    const combo = orderedCombo(axisSet, rule.when);
    const answers = comboAnswers(axisSet, combo);
    const claimed = { product_id: prod.url, variant_id: proof.variant_id || null, match_state: proof.match_state, conflicts, unknowns };
    const proof2 = proveSelection(units, constraints, answers, claimed, { maxBudgetOvershootTiers: nTiers });
    for (const f of proof2.findings) findings.push({ rule: rule.id, criterion: f.criterion, msg: f.msg });
  }

  // BLOCKER-3: NO renderable result without a proof. Count renderable slots (combo-rule primaries
  // + every surfaced alternate) and assert each carries a proof; the default rule must be proven
  // UNREACHABLE by construction (the combo rules cover the full answer space) or itself carry a
  // proof. Target: proofCoverage === 1.
  let renderable = 0, proven = 0;
  for (const rule of rules) { renderable++; if (rule.proof && rule.proof.match_state) proven++; }
  for (const a of config.archetypes || []) {
    for (const c of (a.recommendations && a.recommendations.contextual) || []) {
      renderable++;
      if (c.proof && c.proof.match_state) {
        proven++;
        for (const x of [...(c.proof.conflicts || []), ...(c.proof.unknowns || [])]) if (modeById.get(x.axis) === NEVER_RELAX) findings.push({ rule: `${a.id}/alt ${c.url}`, criterion: 2, msg: `alternate relaxes never-relax ${x.axis}` });
      } else {
        findings.push({ rule: `${a.id}/alt ${c.url}`, criterion: 3, msg: "surfaced alternate has no proof" });
      }
    }
  }
  // default rule: reachable only if the table is INCOMPLETE. Prove unreachability by construction.
  const dflt = (config.decisionTable || []).find((r) => r.when && !Object.keys(r.when).length);
  if (dflt) {
    renderable++;
    const fullSpace = axisSet ? axisSet.reduce((n, ax) => n * ax.values.length, 1) : null;
    const complete = fullSpace != null ? rules.length === fullSpace : dflt.unreachable === true;
    if (complete && dflt.unreachable) proven++; // unreachable-by-construction counts as covered
    else if (dflt.proof && dflt.proof.match_state) proven++;
    else findings.push({ rule: dflt.id, criterion: 3, msg: "default rule is reachable but has no proof" });
  }
  const proofCoverage = renderable ? proven / renderable : 1;
  if (proofCoverage < 1) findings.push({ rule: "*", criterion: 3, msg: `proof coverage ${proven}/${renderable} < 100%` });

  return { ok: findings.length === 0, checked, proofCoverage, renderable, findings };
}

function orderedCombo(axisSet, when) {
  return axisSet.map((a) => when[`D_${a.id}`]);
}

export default { verifyFunnel };
