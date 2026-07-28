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

/**
 * GAP-7: resolve one leaf's COMPARISON GRID — kernel-side. Re-derive the leaf's full candidate set, order it
 * (exact first, then compromise, by id — a DECLARED order), and attach per card the real CTA (product url,
 * ق21), the descriptive attributes, and a tie_break_reason. Verify: every candidate surfaced (no tie hidden),
 * and every card has a real CTA. Returns { cards, families, findings, missingCta, missingAttr }.
 */
function resolveGrid(leaf, units, constraints, opts, catalogMeta) {
  const answers = leaf.answers || {};
  const exact = [], compromise = [];
  for (const u of units) { const { klass } = classifyUnit(u, constraints, answers, opts); if (klass === "exact") exact.push(String(u.id)); else if (klass === "compromise") compromise.push(String(u.id)); }
  const ordered = [...exact.sort(), ...compromise.sort()];
  const cards = ordered.map((id, i) => {
    const meta = (catalogMeta && catalogMeta[id]) || {};
    return { product_id: id, cta_url: meta.url || null, attributes: meta.attributes || {}, tie_break_reason: i < exact.length ? "exact match" : "closest available on the relaxed constraints" };
  });
  const declared = leaf.grid && leaf.grid.count != null ? leaf.grid.count : (leaf.receipt ? leaf.receipt.counts.exact + leaf.receipt.counts.compromise : ordered.length);
  const findings = [];
  if (cards.length !== declared) findings.push(`grid surfaced ${cards.length} ≠ declared ${declared} (a tie may be hidden — hide_ties is forbidden)`);
  return { cards, families: ordered, findings, missingCta: cards.filter((c) => !c.cta_url).map((c) => c.product_id), missingAttr: cards.filter((c) => !c.attributes || !c.attributes.title).map((c) => c.product_id) };
}

/**
 * @param {CertificationInput} cinput
 * @param {{units, constraints, opts?, activeSkus, surfaceReachable, versions, catalogMeta?, skusByFamily?}} ctx
 *   When `catalogMeta` + `skusByFamily` are provided, GAP-7 grids are resolved and I3 uses
 *   `surface_reachable_with_grid` (the delivered surface); otherwise I3 uses `surfaceReachable` (cap-only).
 */
export function certify(cinput, ctx = {}) {
  const { units, constraints, opts = {}, activeSkus = 0, surfaceReachable = 0, versions = {}, catalogMeta = null, skusByFamily = null } = ctx;
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

  // GAP-7: resolve grids (only when the runtime catalog meta is provided) and compute the DELIVERED surface.
  let grid = null;
  if (catalogMeta && skusByFamily) {
    const skusOf = (fams) => fams.flatMap((f) => skusByFamily[f] || []);
    const accountedFamilies = new Set(); const gridFindings = []; let missingCta = 0, missingAttr = 0, gridCount = 0;
    for (const leaf of leaves) {
      const g = resolveGrid(leaf, units, constraints, opts, catalogMeta);
      if (leaf.node_kind === "display") gridCount++;
      for (const f of g.findings) gridFindings.push(`${leaf.node_id}: ${f}`);
      missingCta += g.missingCta.length; missingAttr += g.missingAttr.length;
      for (const c of g.cards) if (c.cta_url) accountedFamilies.add(c.product_id); // ق21: only a card WITH a real CTA counts as surfaced
    }
    const surfacedSkus = new Set(skusOf([...accountedFamilies]));
    const allSkus = new Set(Object.values(skusByFamily).flat());
    const notArrived = [...allSkus].filter((s) => !surfacedSkus.has(s));
    grid = {
      grids: gridCount, cta_from_certificate: true, hide_ties: false,
      missing_cta: missingCta, missing_attributes: missingAttr, findings: gridFindings,
      surface_reachable_with_grid: surfacedSkus.size, not_arrived: notArrived,
    };
  }

  // THE THREE INVARIANTS (artifact-acceptance conditions):
  const I1_no_dead_end = perLeaf.every((l) => l.state !== "HONEST_NO_MATCH");           // every leaf servable
  const I2_input_completeness_and_provenance = perLeaf.every((l) => l.ok);              // every field kernel-determined + traced
  //  I3: every ACTIVE sku is surfaced OR grid-accounted OR witnessed. With GAP-7 the grid surfaces all
  //  candidates (each with a real CTA) ⇒ accounted = surface_reachable_with_grid; else cap-only surfaceReachable.
  const accounted = grid ? grid.surface_reachable_with_grid : surfaceReachable;
  const I3_no_active_sku_without_accounting_or_witness = grid ? (accounted >= activeSkus && grid.missing_cta === 0 && grid.findings.length === 0) : (surfaceReachable >= activeSkus);
  const invariants = { I1_no_dead_end, I2_input_completeness_and_provenance, I3_no_active_sku_without_accounting_or_witness };

  const tally = { expected_reachable_paths: expected, checked, certified, valid_terminals: validTerminals, unresolved, terminal, display };
  let certificate = null, certificate_error = null;
  try { certificate = makeCertificate(tally, versions); } catch (e) { certificate_error = e.message; }

  return { mint_rate, expected_reachable_paths: expected, checked, certified, unresolved, perLeaf, invariants, grid, certificate, certificate_error };
}

export default { certify, makeCertificate, CERTIFIER_VERSION };
