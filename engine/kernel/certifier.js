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

export const CERTIFIER_VERSION = "certifier-2";

/**
 * A REAL per-size certificate is a `SelectionResult` MINTED BY THE KERNEL for this path + this sku — never a
 * derived hash or an authored id (ق21: a buy button needs a real proof). A minted result is a FROZEN object
 * that resolves to exactly this sku and carries a policy_hash (only `makeSelectionResult` produces it). A bare
 * string / plain object fails every clause ⇒ the option is rejected, not counted.
 */
export function isMintedCertificate(cert, sku_id) {
  return !!cert && typeof cert === "object" && Object.isFrozen(cert)
    && cert.product_id === sku_id && typeof cert.match_state === "string" && cert.match_state !== NO_MATCH
    && typeof cert.policy_hash === "string" && cert.policy_hash.length > 0;
}

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
 * GAP-6 (round-12, THE SIZE PICKER): resolve one leaf's comparison grid — ONE card per surfaced family, with an
 * IN-CARD variant/size picker (ق4: size is a folded dimension — never a card per size). EVERY purchasable,
 * in-budget variant is a SELECTABLE option, each carrying its OWN certificate (selection_result_id, buy_url,
 * price, availability, path_certified). Matching is at the VARIANT level with a ceiling (ADR-0063): a variant
 * priced over this path's budget ceiling is NOT purchasable here (shown labeled, no active CTA); an unavailable
 * variant is shown labeled, no CTA (ق14). The DEFAULT pre-selected variant comes from the KERNEL's `select` over
 * the family's in-budget variants (a recorded tie_break_reason) — NEVER a display-layer selection rule.
 * Returns { cards } where each card = { family_id, default_sku_id, default_reason, options:[…selectable…], labeled:[…] }.
 */
function famValues(u) { const out = {}; const v = u && u.values; if (v) for (const k of Object.keys(v)) out[k] = v[k]; return out; }

function resolveLeafGrid(leaf, units, constraints, opts, skuMeta, skusByFamily, budget, catalogSnapshot) {
  const answers = leaf.answers || {};
  const exact = [], compromise = [];
  for (const u of units) { const { klass } = classifyUnit(u, constraints, answers, opts); if (klass === "exact") exact.push(String(u.id)); else if (klass === "compromise") compromise.push(String(u.id)); }
  const famUnit = new Map(units.map((u) => [String(u.id), u]));
  const fams = [...exact.sort(), ...compromise.sort()];
  const useCeiling = !!(budget && answers[budget.axis] != null);
  const ceilIdx = useCeiling ? budget.order.indexOf(answers[budget.axis]) : Infinity;
  // model ONE variant as a kernel unit (family axes + its OWN budget band) so the kernel can mint a real
  // SelectionResult for THIS sku on THIS path.
  const vunitOf = (fid, row) => ({ id: row.id, values: { ...famValues(famUnit.get(fid)), budget: { value: bandOf(row.price, budget && budget.thresholds), grounded: row.price != null } } });
  // the mint opts carry the CATALOG SNAPSHOT — verify() refuses a unit absent from it, so MEMBERSHIP is folded
  // INTO the mint (not a separate downstream check). catalogUrls must be a Set of the shipped sku ids.
  const mintOpts = { ...opts, catalogUrls: catalogSnapshot };
  const mint = (fid, row) => { try { return select([vunitOf(fid, row)], constraints, answers, mintOpts); } catch { return null; } };
  const cards = [];
  for (const fid of fams) {
    const rows = (skusByFamily[fid] || []).map((id) => ({ id, ...(skuMeta[id] || {}) }));
    const prices = rows.map((r) => r.price).filter((p) => p != null);
    const options = [], labeled = [];
    for (const v of rows) {
      const unavailable = v.availability !== "available";
      const over = useCeiling && budget.order.indexOf(bandOf(v.price, budget.thresholds)) > ceilIdx;
      const card = { sku_id: v.id, cta_url: v.buy_url || null, price: v.price, availability: v.availability, attributes: v.attributes || {} };
      if (unavailable) { labeled.push({ ...card, cta_active: false, label: "unavailable" }); continue; }   // ق14: labeled, no CTA
      if (over) { labeled.push({ ...card, cta_active: false, label: "over_budget_ceiling" }); continue; }   // over ceiling → not purchasable here
      if (!validateCta({ sku_id: v.id, cta_url: v.buy_url }, skuMeta, budget, answers).valid) { labeled.push({ ...card, cta_active: false, label: "invalid_cta" }); continue; }
      // MINT a REAL per-size certificate — membership (catalogSnapshot) + verify are folded in. Absent sku /
      // NO_MATCH / mismatch ⇒ not certified (no certificate, not surfaced).
      const cert = mint(fid, v);
      if (!isMintedCertificate(cert, v.id)) { labeled.push({ ...card, cta_active: false, label: cert ? "uncertified" : "not_in_snapshot" }); continue; }
      options.push({ ...card, cta_active: true, path_certified: true, certificate: cert });
    }
    // DEFAULT variant = the KERNEL's choice over the in-budget variants (NOT a display rule); price is only the
    // kernel's stable tie-break key (opts.tieBreak), never a selection override.
    let default_sku_id = null, default_reason = null, comparative_leak = false;
    if (options.length) {
      const priceOf = new Map(options.map((o) => [o.sku_id, o.price]));
      const sel = select(options.map((o) => vunitOf(fid, { id: o.sku_id, price: o.price })), constraints, answers, { ...mintOpts, tieBreak: (u) => priceOf.get(u.id) ?? 0 });
      default_sku_id = sel.product_id; default_reason = sel.tie_break_reason;
      // SINGLETON-SOUNDNESS guard: singleton mint == group eval is only valid while NO COMPARATIVE rule exists
      // (one that excludes/promotes a candidate BECAUSE of another). The group winner, evaluated ALONE, must be
      // identical (same pick, same match_state); a divergence ⇒ a comparative rule leaked in ⇒ flag it.
      if (default_sku_id != null) { const alone = mint(fid, { id: default_sku_id, price: priceOf.get(default_sku_id) }); if (!alone || alone.product_id !== default_sku_id || alone.match_state !== sel.match_state) comparative_leak = true; }
    }
    // PRICE DISPLAY HONESTY: a multi-size family spans a range — the card shows "from"/range, never a single
    // price masquerading as THE product price.
    const price_from = prices.length ? Math.min(...prices) : null, price_to = prices.length ? Math.max(...prices) : null;
    cards.push({ family_id: fid, default_sku_id, default_reason, comparative_leak, options, labeled, price_from, price_to, price_is_range: price_from != null && price_from !== price_to });
  }
  return { cards };
}

/**
 * @param {CertificationInput} cinput
 * @param {{units, constraints, opts?, activeSkus, surfaceReachable, versions, skuMeta?, skusByFamily?, budget?}} ctx
 *   When `skuMeta` + `skusByFamily` are provided, I3 is measured at SKU GRANULARITY via the SIZE PICKER
 *   (round-12, ADR-0063): each active sku needs a Surface witness (a selectable option in a reachable leaf) AND
 *   a Purchase witness (its own valid, in-budget CTA). The default variant per family comes from the kernel.
 *   `budget` = { axis, thresholds, order } is the variant-level purchase-ceiling axis. Without `skuMeta`, I3
 *   falls back to `surfaceReachable` (the legacy family/cap-only number).
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

  // I3 measurement (round-12, ADR-0063): the SIZE PICKER surfaces EVERY in-budget purchasable variant as a
  // SELECTABLE option (Surface witness), each with its own valid, in-budget CTA (Purchase witness). Matching is
  // at the VARIANT level with a ceiling — an over-ceiling / unavailable variant is shown LABELED (no active CTA),
  // never credited. A sku is accounted iff it is a selectable option in ≥1 reachable leaf.
  let grid = null;
  if (skuMeta && skusByFamily) {
    // the referenced CATALOG SNAPSHOT (shipped sku ids). Membership is enforced INSIDE the mint (verify), so a
    // sku absent here is never certified — regardless of its offer data (skuMeta) or validateCta.
    const catalogSnapshot = ctx.catalogSnapshot instanceof Set ? ctx.catalogSnapshot : new Set(Object.keys(skuMeta));
    const surfacedSkus = new Set();      // selectable AND kernel-certified (Surface+Purchase witness) anywhere
    const labeledSkus = new Set();        // shown labeled (over-ceiling / unavailable / uncertified) in ≥1 leaf
    const labeledReason = new Map();      // sku → why it was labeled (for a legible not-arrived reason)
    const gridFindings = []; let uncertified = 0, missingAttr = 0, defaultsNotFromKernel = 0, defaultOutsideOptions = 0, missingRange = 0, comparativeLeak = 0;
    for (const leaf of leaves) {
      const { cards } = resolveLeafGrid(leaf, units, constraints, opts, skuMeta, skusByFamily, budget, catalogSnapshot);
      for (const card of cards) {
        if (card.comparative_leak) comparativeLeak++;
        for (const o of card.options) {
          if (isMintedCertificate(o.certificate, o.sku_id)) surfacedSkus.add(o.sku_id);   // a REAL minted cert — not a hash
          else uncertified++;                                                              // an option without a real certificate is rejected
          if (!o.attributes || !o.attributes.title) missingAttr++;
        }
        for (const l of card.labeled) { labeledSkus.add(l.sku_id); if (!surfacedSkus.has(l.sku_id)) labeledReason.set(l.sku_id, l.label); }
        // PRICE DISPLAY HONESTY: a multi-size family must show a range/from, never a single price.
        const distinctPrices = new Set(card.options.map((o) => o.price)).size + new Set(card.labeled.map((l) => l.price)).size;
        if (distinctPrices > 1 && !card.price_is_range) missingRange++;
        if (card.options.length) {
          if (card.default_sku_id == null || card.default_reason == null) defaultsNotFromKernel++;      // default must come from the kernel select
          else if (!card.options.some((o) => o.sku_id === card.default_sku_id)) defaultOutsideOptions++; // and be one of the selectable options
        }
      }
    }
    const allSkus = new Set(Object.values(skusByFamily).flat());
    const notArrived = [...allSkus].filter((s) => !surfacedSkus.has(s));
    // WHY a sku didn't arrive: family never surfaced anywhere = family_buried; else only ever shown labeled
    // (over-ceiling in every path it could appear) = variant_over_ceiling; else band-exact locked it out of every
    // path where it would be in-budget = band_locked_out.
    const surfacedFamilies = new Set([...surfacedSkus].map((s) => skuMeta[s] && skuMeta[s].family_id));
    const LABEL_REASON = { over_budget_ceiling: "variant_over_ceiling", unavailable: "variant_unavailable", not_in_snapshot: "not_in_snapshot", uncertified: "uncertified", invalid_cta: "invalid_cta" };
    const reasonOf = (s) => {
      const f = skuMeta[s] && skuMeta[s].family_id;
      if (!surfacedFamilies.has(f)) return "family_buried";
      if (labeledReason.has(s)) return LABEL_REASON[labeledReason.get(s)] || "variant_over_ceiling";
      return "band_locked_out";
    };
    // NAME the family + size for every not-arrived sku, so a band_locked_out failure is legible on sight.
    const notArrivedDetail = notArrived.map((s) => ({ sku_id: s, family_id: skuMeta[s] && skuMeta[s].family_id, price: skuMeta[s] && skuMeta[s].price, reason: reasonOf(s) }));
    const reasonTally = notArrivedDetail.reduce((m, d) => ((m[d.reason] = (m[d.reason] || 0) + 1), m), {});
    const bandLockedOut = notArrivedDetail.filter((d) => d.reason === "band_locked_out");
    const bandLockedOutMessage = bandLockedOut.length ? `band_locked_out (${bandLockedOut.length}): ` + bandLockedOut.slice(0, 10).map((d) => `${d.family_id}·${d.sku_id.split("::").pop()}@${d.price}`).join(", ") : null;
    grid = {
      level: "sku-picker", one_card_per_family: true, certificates_minted_by_kernel: uncertified === 0, defaults_from_kernel: defaultsNotFromKernel === 0,
      uncertified, missing_attributes: missingAttr, defaults_not_from_kernel: defaultsNotFromKernel, default_outside_options: defaultOutsideOptions, missing_range: missingRange,
      comparative_leak: comparativeLeak, membership_in_mint: true, findings: gridFindings, surface_reachable_with_grid: surfacedSkus.size, not_arrived: notArrived,
      not_arrived_detail: notArrivedDetail, not_arrived_by_reason: reasonTally, band_locked_out_message: bandLockedOutMessage, labeled_count: labeledSkus.size,
    };
  }

  // THE THREE INVARIANTS (artifact-acceptance conditions):
  const I1_no_dead_end = perLeaf.every((l) => l.state !== "HONEST_NO_MATCH");           // every leaf servable
  const I2_input_completeness_and_provenance = perLeaf.every((l) => l.ok);              // every field kernel-determined + traced
  //  I3: every ACTIVE sku has a Surface+Purchase witness. SKU-level (skuMeta) ⇒ accounted =
  //  surface_reachable_with_grid AND no invalid CTA / grid finding; else the legacy family/cap-only surfaceReachable.
  const accounted = grid ? grid.surface_reachable_with_grid : surfaceReachable;
  const I3_no_active_sku_without_accounting_or_witness = grid
    ? (accounted >= activeSkus && grid.uncertified === 0 && grid.findings.length === 0 && grid.defaults_not_from_kernel === 0 && grid.default_outside_options === 0 && grid.missing_range === 0 && grid.comparative_leak === 0)
    : (surfaceReachable >= activeSkus);
  const invariants = { I1_no_dead_end, I2_input_completeness_and_provenance, I3_no_active_sku_without_accounting_or_witness };

  const tally = { expected_reachable_paths: expected, checked, certified, valid_terminals: validTerminals, unresolved, terminal, display };
  let certificate = null, certificate_error = null;
  try { certificate = makeCertificate(tally, versions); } catch (e) { certificate_error = e.message; }

  return { mint_rate, expected_reachable_paths: expected, checked, certified, unresolved, perLeaf, invariants, grid, certificate, certificate_error };
}

export default { certify, makeCertificate, validateCta, CERTIFIER_VERSION };
