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
import { checkPromiseBinding } from "./promiseBinding.js";
import { isJunkLabel } from "./labelQuality.js";
import { makeReport } from "./verificationReport.js";

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
  // Discriminated union (ADR-0039): a combo rule is COMMERCE (proven product) or TERMINAL (honest
  // ending — NO_MATCH/RESTART/… carrying a reason + next_action, and NO product). Both are verified,
  // but differently: a COMMERCE rule proves the chosen product is optimal; a NO_MATCH terminal proves
  // (independently) that NO eligible product exists within the numbered budget policy.
  const withWhen = (config.decisionTable || []).filter((r) => r.when && Object.keys(r.when).length);
  const rules = withWhen.filter((r) => r.kind !== "TERMINAL");
  const terminals = withWhen.filter((r) => r.kind === "TERMINAL");

  // Independent re-run inputs (criteria 4–6): rebuild the kernel constraints/units from axisSet.
  // NO budget bound is threaded from here into the oracle — the reference evaluator reads the
  // numbered policy registry itself (audit #6), so the matcher can never hand it a value.
  let constraints = null, units = null;
  if (axisSet) {
    constraints = compileConstraints(axisSet);
    units = compileUnits(products, axisSet);
  }

  let checked = 0;
  for (const rule of rules) {
    checked++;
    const arch = archById.get(rule.result);
    const prod = arch && arch.recommendations && arch.recommendations.primary;

    // (1) product & SKU exist in the served catalog
    if (!prod || !prod.url) { findings.push({ rule: rule.id, criterion: 1, msg: "COMMERCE rule resolves to no product" }); continue; }
    if (!catalogUrls.has(prod.url)) findings.push({ rule: rule.id, criterion: 1, msg: `product ${prod.url} not in served catalog` });

    const proof = rule.proof || {};
    const conflicts = proof.conflicts || [];
    const unknowns = proof.unknowns || [];

    // COMMERCE with no ProvenSelection is unrepresentable — reject at publish time.
    if (!proof.match_state) findings.push({ rule: rule.id, criterion: 3, msg: "COMMERCE rule has no ProvenSelection" });

    // (2) never-relax never relaxed / unknown
    for (const c of conflicts) if (modeById.get(c.axis) === NEVER_RELAX) findings.push({ rule: rule.id, criterion: 2, msg: `never-relax ${c.axis} relaxed` });
    for (const u of unknowns) if (modeById.get(u.axis) === NEVER_RELAX) findings.push({ rule: rule.id, criterion: 2, msg: `never-relax ${u.axis} unknown` });

    if (!axisSet) continue; // criteria 3–7 need the independent oracle

    // INDEPENDENT reference oracle (BLOCKER-1 / C11) for this exact answer-path. It shares only the
    // base predicates with the kernel — its selection/comparator/tie-break are a separate
    // implementation — so this is a genuine second opinion on criteria 3, 4, 5, 6, 7. No bound is
    // passed: the oracle reads maxBudgetTierDistance from the policy registry itself.
    const combo = orderedCombo(axisSet, rule.when);
    const answers = comboAnswers(axisSet, combo);
    const claimed = { product_id: prod.url, variant_id: proof.variant_id || null, match_state: proof.match_state, conflicts, unknowns };
    const proof2 = proveSelection(units, constraints, answers, claimed);
    for (const f of proof2.findings) findings.push({ rule: rule.id, criterion: f.criterion, msg: f.msg });
  }

  // TERMINAL verification (ADR-0039). A NO_MATCH terminal must be PROVEN: the independent oracle
  // re-runs its own eligibility over the served catalog for that exact answer-path and confirms NO
  // eligible unit exists within the numbered budget policy (claimed product_id = null). If any
  // eligible product DID exist, the terminal is a fabricated dead-end and the funnel FAILS. Non-
  // NO_MATCH terminals (RESTART/STALE/…) are runtime states, not catalog claims — nothing to prove
  // here beyond the structural checks trustValidate already enforces.
  for (const t of terminals) {
    checked++;
    if (t.result || (t.proof && t.proof.product_id)) { findings.push({ rule: t.id, criterion: 1, msg: "TERMINAL rule carries a product" }); }
    if (t.terminal_state === "NO_MATCH") {
      if (!t.terminal_proof) { findings.push({ rule: t.id, criterion: 3, msg: "NO_MATCH terminal has no terminal_proof" }); }
      if (!axisSet) continue;
      const combo = orderedCombo(axisSet, t.when);
      const answers = comboAnswers(axisSet, combo);
      const proof2 = proveSelection(units, constraints, answers, { product_id: null });
      for (const f of proof2.findings) findings.push({ rule: t.id, criterion: f.criterion, msg: `NO_MATCH unproven — ${f.msg}` });
    }
  }

  // BLOCKER-3: NO renderable COMMERCE result without a proof. Denominator = COMMERCE slots only
  // (combo-rule primaries + every surfaced alternate); TERMINAL cells render a state, not a product,
  // so they are NOT proof-coverage slots (they're proven separately above). Target: proofCoverage
  // === 1 over COMMERCE. The when:{} default MUST be TERMINAL (ADR-0039) — never a product.
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
  // default rule (when:{}): the honest catch-all for a missing/edited answer. It MUST be TERMINAL —
  // a when:{} COMMERCE default is a global product fallback (exactly what ADR-0039 forbids).
  const dflt = (config.decisionTable || []).find((r) => r.when && !Object.keys(r.when).length);
  if (dflt && dflt.kind !== "TERMINAL") {
    findings.push({ rule: dflt.id, criterion: 3, msg: "default rule (when:{}) is not TERMINAL — a global product fallback is forbidden" });
  }
  const proofCoverage = renderable ? proven / renderable : 1;
  if (proofCoverage < 1) findings.push({ rule: "*", criterion: 3, msg: `COMMERCE proof coverage ${proven}/${renderable} < 100%` });

  // PROMISE BINDING (item 1): each offered option's group is derived from its predicate; witness
  // that no option is dead, and no label inverts/widens its value. A contradiction fails the funnel.
  if (axisSet) {
    const pb = checkPromiseBinding(axisSet, { products });
    for (const f of pb.findings) findings.push({ rule: `option ${f.axis}=${f.value}`, criterion: 8, msg: `promise-binding witness ${f.witness}: ${f.msg}` });
  }

  // PUBLISH GATE (P0, FUNNEL-QUALITY-FIX-PLAN): a shopper-facing option LABEL must be a meaningful
  // decision attribute, never a mined fragment/boilerplate. A junk label FAILS the build, so a
  // funnel like the "based/de/packages" taste axis can never reach a user (comprehensibility is
  // part of the Promise, not a luxury).
  for (const q of config.questions || []) {
    for (const o of q.options || []) {
      if (isJunkLabel(o && o.label)) findings.push({ rule: `question ${q.id}`, criterion: 8, msg: `junk option label "${o && o.label}" is not a meaningful choice` });
    }
  }

  // VERIFICATION REPORT (ADR-0043): `ok` is DERIVED by the independent library, which FAILS CLOSED on an
  // empty expected set — an absent/empty decision table can no longer "pass" vacuously (checked=0 → ok).
  // expected = the reachable answer-path rules that make a claim (COMMERCE + TERMINAL, excluding the
  // when:{} default). `checked` is incremented once per such rule before any continue, so checked ===
  // expected for a well-formed table; a table with zero reachable rules has expected 0 → ok false.
  const reachableIds = new Set(withWhen.map((r) => r.id));
  const failingReachable = new Set(findings.map((f) => f.rule).filter((id) => reachableIds.has(id)));
  const report = makeReport({
    expected_count: withWhen.length,
    observed_count: withWhen.length,
    checked_count: checked,
    passed_count: checked - failingReachable.size,
    failed_count: findings.length,
    skipped_count: withWhen.length - checked,
    missing_ids: [],
    failures: findings,
  });
  // Back-compat fields (ok/checked/proofCoverage/renderable/findings) kept so existing callers are
  // unchanged; `report` is the authoritative structured result. `ok` now also requires expected > 0.
  return { ok: report.ok, report, checked, proofCoverage, renderable, findings };
}

function orderedCombo(axisSet, when) {
  return axisSet.map((a) => when[`D_${a.id}`]);
}

export default { verifyFunnel };
