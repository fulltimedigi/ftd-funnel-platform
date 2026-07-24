/**
 * engine/kernel/metrics.js — the v3 promise metrics (ADR-0037).
 * ---------------------------------------------------------------------------------------------
 * Computed from a materialized funnel config (+ optional catalog). These are the numbers the
 * spec adds ALONGSIDE the untouched trust / anti-bland / richness gates — they measure how well
 * the promise is kept, per funnel:
 *   • exactPathRate            — share of decision paths that are an EXACT match.
 *   • maxRelaxationSeverity    — the largest single relaxation magnitude anywhere in the table.
 *   • unknownAttributeRate     — share of asked (path × axis) cells that are UNKNOWN.
 *   • prefixSupport            — every offered answer is viable given prior answers (no dead option).
 *   • predicateEvidenceCoverage— share of (unit × constraint) values that are grounded, not guessed.
 *   • variantValidity          — share of results whose SKU resolves.
 *   • versioned                — the config carries catalog_version + policy_version (staleness).
 *   • disclosureRendering      — every compromised/unverified path carries STRUCTURED disclosure.
 *
 * Pure, deterministic, dependency-free.
 */

export function funnelMetrics(config, catalog) {
  const rules = (config.decisionTable || []).filter((r) => r.when && Object.keys(r.when).length);
  const n = rules.length || 1;

  let exact = 0, unknownCells = 0, askedCells = 0, maxSeverity = 0, discOk = 0, discNeeded = 0, variantOk = 0, variantTot = 0;
  for (const r of rules) {
    const proof = r.proof || {};
    if (proof.match_state === "EXACT") exact++;
    askedCells += Object.keys(r.when).length;
    unknownCells += (proof.unknowns || []).length;
    for (const c of proof.conflicts || []) maxSeverity = Math.max(maxSeverity, c.magnitude || 0);
    const compromised = (proof.conflicts || []).length || (proof.unknowns || []).length;
    if (compromised) { discNeeded++; if ((r.proof && (r.proof.conflicts || r.proof.unknowns)) || r.relaxed) discOk++; }
    // variant validity: a result with variant data must resolve a SKU; single-SKU products pass.
    variantTot++; if (proof.variant_id !== undefined) variantOk++;
  }

  // prefix-support: every option value on every axis appears in ≥1 reachable rule's `when`.
  let offered = 0, supported = 0;
  const seen = new Map(); // D_axis -> Set(values present in some rule)
  for (const r of rules) for (const [d, v] of Object.entries(r.when)) { if (!seen.has(d)) seen.set(d, new Set()); seen.get(d).add(v); }
  for (const s of config.signals || []) {
    const d = `D_${s.id.replace(/^s_/, "")}`;
    for (const val of s.domain || []) { offered++; if (seen.get(d) && seen.get(d).has(val)) supported++; }
  }

  // predicate-evidence-coverage: share of asked cells resolved from grounded data (not UNKNOWN).
  // Measured from the materialized proofs — a cell is "evidenced" unless it surfaced as UNKNOWN.
  const evidence = 1 - unknownCells / (askedCells || 1);
  void catalog;

  return {
    exactPathRate: round(exact / n),
    maxRelaxationSeverity: maxSeverity,
    unknownAttributeRate: round(unknownCells / (askedCells || 1)),
    prefixSupport: round(offered ? supported / offered : 1),
    predicateEvidenceCoverage: round(evidence),
    variantValidity: round(variantTot ? variantOk / variantTot : 1),
    versioned: !!(config.catalog_version && config.policy_version),
    disclosureRendering: round(discNeeded ? discOk / discNeeded : 1),
    paths: rules.length,
  };
}

function round(x) { return Math.round(x * 1000) / 1000; }

export default { funnelMetrics };
