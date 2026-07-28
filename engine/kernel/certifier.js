/**
 * engine/kernel/certifier.js — THE CERTIFIER (phase 2, round-10, ADR-0058/0059). Kernel-side.
 * ===========================================================================================
 * The moment of truth: it decides whether a compiled artifact is actually runnable — by RE-DERIVING, never
 * by trusting the compiler's receipts. For every leaf it walks the accumulated answers, re-runs the KERNEL
 * from scratch (`classifyUnit` + `select` — the one source of truth), and compares the re-derivation to what
 * the artifact CLAIMS. Any difference ⇒ the artifact does not represent the kernel ⇒ certification failure.
 * This is TREE↔RUNTIME EQUIVALENCE — the core of the phase.
 *
 * The certificate CONSTRUCTOR lives here (kernel-side) and is minted ONLY when
 *   expected>0 ∧ checked=expected ∧ certified=expected ∧ valid_terminals=expected ∧ unresolved=0.
 * The THREE INVARIANTS are artifact-acceptance conditions reported alongside — I3
 * (NoActiveSKUWithoutAccountingOrWitness) blocks PUBLISH, not the certificate.
 */

import { classifyUnit, select, EXACT, COMPROMISE, NO_MATCH } from "./constraintKernel.js";

export const CERTIFIER_VERSION = "certifier-1";

/** THE certificate constructor (kernel-monopoly). Refuses unless the whole artifact is checked+certified. */
export function makeCertificate(tally, versions) {
  const { expected_reachable_paths: expected, checked, certified, valid_terminals, unresolved } = tally;
  if (!(Number.isInteger(expected) && expected > 0 && checked === expected && certified === expected && valid_terminals === expected && unresolved === 0)) {
    throw new Error(`certificate refused: expected=${expected} checked=${checked} certified=${certified} valid_terminals=${valid_terminals} unresolved=${unresolved} — mint only when checked=certified=valid_terminals=expected>0 ∧ unresolved=0`);
  }
  return Object.freeze({
    ...tally,
    versions: Object.freeze({ ...versions }),
    certifier_version: CERTIFIER_VERSION,
  });
}

/** Re-derive one leaf from the kernel and compare to the artifact's receipt. Returns { ok, state, pick, findings }. */
function certifyLeaf(leaf, units, constraints, opts) {
  const answers = leaf.answers || {};
  // RE-DERIVE from scratch — the single source of truth. Do NOT read the receipt to compute anything.
  const exact = [], compromise = [];
  for (const u of units) { const { klass } = classifyUnit(u, constraints, answers, opts); if (klass === "exact") exact.push(String(u.id)); else if (klass === "compromise") compromise.push(String(u.id)); }
  const state = exact.length ? "EXACT_AVAILABLE" : compromise.length ? "COMPROMISE_ONLY" : "HONEST_NO_MATCH";
  const sel = select(units, constraints, answers, opts); // the kernel's fully-determined pick + disclosure
  // COMPARE to the artifact's CLAIM (receipt). Any divergence = the artifact ≠ the kernel.
  const rc = leaf.receipt || {};
  const findings = [];
  if (rc.state_outcome !== state) findings.push(`state ${rc.state_outcome} ≠ re-derived ${state}`);
  if (!rc.counts || rc.counts.exact !== exact.length) findings.push(`exact ${rc.counts && rc.counts.exact} ≠ re-derived ${exact.length}`);
  if (!rc.counts || rc.counts.compromise !== compromise.length) findings.push(`compromise ${rc.counts && rc.counts.compromise} ≠ re-derived ${compromise.length}`);
  // INPUT-COMPLETENESS: a non-NO_MATCH leaf must resolve to a fully-determined pick, inside the re-derived pool.
  if (state !== "HONEST_NO_MATCH") {
    if (sel.product_id == null) findings.push("SelectionResult not fully kernel-determined (null pick on a servable leaf)");
    else if (!exact.includes(String(sel.product_id)) && !compromise.includes(String(sel.product_id))) findings.push(`kernel pick ${sel.product_id} not in the re-derived pool (provenance break)`);
    // PROVENANCE: match_state of the pick must agree with the re-derived state.
    else if (sel.match_state === EXACT && state !== "EXACT_AVAILABLE") findings.push(`pick match_state EXACT but state ${state}`);
    else if (sel.match_state === NO_MATCH && state !== "HONEST_NO_MATCH") findings.push(`pick NO_MATCH but state ${state}`);
  }
  return { ok: findings.length === 0, state, pick: sel.product_id ?? null, match_state: sel.match_state, findings };
}

/** the answered budget band's ceiling band for a price (low ≤ t1 < mid ≤ t2 < high). */
function bandOf(price, thresholds) { return price == null ? null : price <= thresholds[0] ? "low" : price <= thresholds[1] ? "mid" : "high"; }

/**
 * THE CTA VALIDITY GUARD (round-11, ADR-0062) — existence is NOT validity. A grid card's CTA is valid only when
 * it (1) resolves to a SPECIFIC sku (cta_url === that sku's own buy_url — a family url is not a per-variant CTA),
 * (2) that sku is PRESENT in the shipped catalog snapshot (skuMeta), and (3) the sku SATISFIES the path's HARD
 * budget ceiling (a variant priced over the answered band's ceiling is a broken purchase promise). Returns
 * { valid, reason }.
 */
export function validateCta(card, skuMeta, budget, answers) {
  const meta = skuMeta && skuMeta[card.sku_id];
  if (!meta) return { valid: false, reason: "cta_sku_not_in_snapshot" };
  if (!card.cta_url) return { valid: false, reason: "cta_missing" };
  if (card.cta_url !== meta.buy_url) return { valid: false, reason: "cta_does_not_resolve_to_sku" };
  if (budget && answers && answers[budget.axis] != null) {
    const ceilIdx = budget.order.indexOf(answers[budget.axis]);
    if (budget.order.indexOf(bandOf(meta.price, budget.thresholds)) > ceilIdx) return { valid: false, reason: "cta_over_budget_ceiling" };
  }
  return { valid: true, reason: null };
}

/**
 * GAP-7 (round-11, SKU-LEVEL): resolve one leaf's comparison grid at SKU GRANULARITY. The runtime surfaces
 * FAMILIES, and each family card carries ONE CTA → one variant; so per surfaced family we PIN the cheapest
 * in-budget available variant (deterministic: price, then sku_id) as the one selectable+purchasable sku. The
 * family's OTHER variants have no selection path (the variant/size picker is unbuilt) — they are reported, per
 * leaf, as over-ceiling (priced beyond this path's budget) or otherwise not individually pinned. Every emitted
 * card is validated by `validateCta`. Returns { cards, overCeiling } where cards are the VALID pinned skus.
 */
function resolveLeafSkus(leaf, units, constraints, opts, skuMeta, skusByFamily, budget) {
  const answers = leaf.answers || {};
  const exact = [], compromise = [];
  for (const u of units) { const { klass } = classifyUnit(u, constraints, answers, opts); if (klass === "exact") exact.push(String(u.id)); else if (klass === "compromise") compromise.push(String(u.id)); }
  const fams = [...exact.sort(), ...compromise.sort()];
  const useCeiling = !!(budget && answers[budget.axis] != null);
  const ceilIdx = useCeiling ? budget.order.indexOf(answers[budget.axis]) : Infinity;
  const cards = [], overCeiling = [];
  for (let fi = 0; fi < fams.length; fi++) {
    const fid = fams[fi];
    const variants = (skusByFamily[fid] || []).map((id) => ({ id, ...(skuMeta[id] || {}) })).filter((v) => v.availability === "available");
    const inBudget = [];
    for (const v of variants) {
      const over = useCeiling && budget.order.indexOf(bandOf(v.price, budget.thresholds)) > ceilIdx;
      if (over) overCeiling.push(v.id); else inBudget.push(v);
    }
    if (!inBudget.length) continue; // no in-budget variant on this path — the family cannot be pinned here
    inBudget.sort((a, b) => (a.price - b.price) || (a.id < b.id ? -1 : 1));
    const pin = inBudget[0];
    const card = { sku_id: pin.id, family_id: fid, cta_url: pin.buy_url || null, price: pin.price, attributes: pin.attributes || {}, tie_break_reason: fi < exact.length ? "exact match" : "closest available on the relaxed constraints" };
    if (validateCta(card, skuMeta, budget, answers).valid) cards.push(card); // only a VALID CTA counts as surfaced
  }
  return { cards, overCeiling };
}

/**
 * @param {CertificationInput} cinput
 * @param {{units, constraints, opts?, activeSkus, surfaceReachable, versions, skuMeta?, skusByFamily?, budget?}} ctx
 *   When `skuMeta` + `skusByFamily` are provided, I3 is measured at SKU GRANULARITY (round-11, ADR-0062): each
 *   active sku needs a Surface+Purchase witness — a VALID, in-budget, sku-specific CTA in a reachable leaf.
 *   `budget` = { axis, thresholds, order } is the hard purchase-ceiling axis. Without `skuMeta`, I3 falls back
 *   to `surfaceReachable` (the family/cap-only number) — the legacy, blunter measure.
 */
export function certify(cinput, ctx = {}) {
  const { units, constraints, opts = {}, activeSkus = 0, surfaceReachable = 0, versions = {}, skuMeta = null, skusByFamily = null, budget = null } = ctx;
  if (!cinput || !cinput.root) throw new Error("certify: a CertificationInput is required");
  const leaves = [];
  (function walk(n) { if (n && n.node_kind === "question") for (const c of n.children || []) walk(c.child); else if (n) leaves.push(n); })(cinput.root);

  const perLeaf = [];
  let certified = 0, unresolved = 0, validTerminals = 0, terminal = 0, display = 0;
  for (const leaf of leaves) {
    const r = certifyLeaf(leaf, units, constraints, opts);
    if (leaf.node_kind === "terminal") terminal++; else if (leaf.node_kind === "display") display++;
    if (r.ok) { certified++; validTerminals++; } else unresolved++;
    perLeaf.push({ node_id: leaf.node_id, node_kind: leaf.node_kind, state: r.state, pick: r.pick, ok: r.ok, findings: r.findings });
  }
  const expected = cinput.expected_reachable_paths;
  const checked = leaves.length;
  const mint_rate = expected > 0 ? certified / expected : 0;

  // I3 measurement (round-11, ADR-0062): SKU-LEVEL when skuMeta is provided — each active sku needs a VALID,
  // in-budget, sku-specific CTA in a reachable leaf (Surface + Purchase witness). A family being surfaced does
  // NOT credit its buried variants. The runtime pins ONE variant per family card, so a multi-variant family's
  // extra sizes strand as variant_unreachable (the variant/size picker is unbuilt).
  let grid = null;
  if (skuMeta && skusByFamily) {
    const surfacedSkus = new Set(), overCeilingSkus = new Set(); const gridFindings = []; let invalidCta = 0, missingAttr = 0;
    for (const leaf of leaves) {
      const { cards, overCeiling } = resolveLeafSkus(leaf, units, constraints, opts, skuMeta, skusByFamily, budget);
      for (const id of overCeiling) overCeilingSkus.add(id);
      for (const c of cards) { surfacedSkus.add(c.sku_id); if (!c.attributes || !c.attributes.title) missingAttr++; }
    }
    const allSkus = new Set(Object.values(skusByFamily).flat());
    const notArrived = [...allSkus].filter((s) => !surfacedSkus.has(s));
    const pinnedFamilies = new Set([...surfacedSkus].map((s) => skuMeta[s] && skuMeta[s].family_id));
    // WHY a sku didn't arrive: family never pinned anywhere = family_buried; else over-ceiling in every path it
    // could appear = variant_over_ceiling; else the family surfaced but this variant is not individually
    // selectable (the size/variant picker is unbuilt) = variant_unreachable.
    const reasonOf = (s) => {
      const f = skuMeta[s] && skuMeta[s].family_id;
      if (!pinnedFamilies.has(f)) return "family_buried";
      if (overCeilingSkus.has(s) && !surfacedSkus.has(s)) return "variant_over_ceiling";
      return "variant_unreachable";
    };
    const notArrivedDetail = notArrived.map((s) => ({ sku_id: s, reason: reasonOf(s) }));
    const reasonTally = notArrivedDetail.reduce((m, d) => ((m[d.reason] = (m[d.reason] || 0) + 1), m), {});
    grid = {
      level: "sku", cta_from_certificate: true, hide_ties: false,
      invalid_cta: invalidCta, missing_attributes: missingAttr, findings: gridFindings,
      surface_reachable_with_grid: surfacedSkus.size, not_arrived: notArrived, not_arrived_detail: notArrivedDetail,
      not_arrived_by_reason: reasonTally, over_ceiling: [...overCeilingSkus],
    };
  }

  // THE THREE INVARIANTS (artifact-acceptance conditions):
  const I1_no_dead_end = perLeaf.every((l) => l.state !== "HONEST_NO_MATCH");           // every leaf servable
  const I2_input_completeness_and_provenance = perLeaf.every((l) => l.ok);              // every field kernel-determined + traced
  //  I3: every ACTIVE sku has a Surface+Purchase witness. SKU-level (skuMeta) ⇒ accounted =
  //  surface_reachable_with_grid AND no invalid CTA / grid finding; else the legacy family/cap-only surfaceReachable.
  const accounted = grid ? grid.surface_reachable_with_grid : surfaceReachable;
  const I3_no_active_sku_without_accounting_or_witness = grid ? (accounted >= activeSkus && grid.invalid_cta === 0 && grid.findings.length === 0) : (surfaceReachable >= activeSkus);
  const invariants = { I1_no_dead_end, I2_input_completeness_and_provenance, I3_no_active_sku_without_accounting_or_witness };

  const tally = { expected_reachable_paths: expected, checked, certified, valid_terminals: validTerminals, unresolved, terminal, display };
  let certificate = null, certificate_error = null;
  try { certificate = makeCertificate(tally, versions); } catch (e) { certificate_error = e.message; }

  return { mint_rate, expected_reachable_paths: expected, checked, certified, unresolved, perLeaf, invariants, grid, certificate, certificate_error };
}

export default { certify, makeCertificate, validateCta, CERTIFIER_VERSION };
