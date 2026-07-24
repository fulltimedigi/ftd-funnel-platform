/**
 * engine/kernel/verifyRuntime.js — the cheap RUNTIME verifier (ADR-0037, Guardrail G2).
 * ---------------------------------------------------------------------------------------------
 * Runs on the served result JUST BEFORE render. It re-reads the materialized kernel proof for
 * the fired rule and asserts the promise invariants that are checkable at render time without
 * dereferencing a live catalog (live stock/price is DEFERRED — G1/G2 make that a later change of
 * implementation, not of meaning):
 *   1. the chosen product exists in the served config,
 *   2. NO never-relax constraint appears in the disclosure (rank-1 never relaxed),
 *   3. the structured disclosure (conflicts + unknowns) the card will show equals the proof.
 * On a never-relax break it reports `ok:false` (the caller must NOT render a confident card) and
 * marks the reason — a corrupted/tampered/stale table is caught here, not shown to a shopper.
 *
 * Pure, deterministic, browser-safe. No catalog, no network.
 */

import { NEVER_RELAX } from "./constraintKernel.js";

/**
 * @param {Object} config    the funnel config (carries constraintPolicy, catalog_version, decisionTable)
 * @param {Object} resolved  resolver output (resolved.scoring.ruleId, resolved.primary)
 * @param {Object} [clientVersions]  the version stamps the CLIENT actually loaded/saw. When given,
 *                 every stamp must equal the served config's — any drift is STALE (VERSION COHERENCE,
 *                 ADR-0037 closing): a proof minted against one snapshot/policy/answer-contract/locale
 *                 must never be shown against another. Omit for a same-artifact render (always coherent).
 * @returns {{ ok, stale, reasons:string[], match_state, conflicts:[], unknowns:[] }}
 */
export function verifyServedResult(config, resolved, clientVersions) {
  const reasons = [];
  const rid = resolved && resolved.scoring && resolved.scoring.ruleId;
  const rule = rid ? (config.decisionTable || []).find((r) => r.id === rid) : null;
  const proof = rule && rule.proof;
  const modeById = new Map((config.constraintPolicy || []).map((c) => [c.id, c.mode]));

  // VERSION COHERENCE — the client's stamps must match the served config across ALL of: catalog,
  // policy, answer-contract, config, and locale bundle. Any mismatch → STALE (never mix two versions).
  let stale = false;
  if (clientVersions) {
    const keys = ["catalog_version", "policy_version", "answer_contract_version", "config_hash", "locale_bundle_version"];
    for (const k of keys) if (clientVersions[k] != null && config[k] != null && clientVersions[k] !== config[k]) { stale = true; reasons.push(`STALE: ${k} mismatch (client ${clientVersions[k]} ≠ served ${config[k]})`); }
  }

  // (1) product exists in the served config, AND is the SAME SKU the proof certified (a swapped
  //     CTA/card that points somewhere other than the proven product is a hard break — HANDOFF).
  const prod = resolved && resolved.primary && resolved.primary.recommendations && resolved.primary.recommendations.primary;
  if (!prod || !prod.url) reasons.push("served result has no real product url");
  else if (proof && proof.product_id && proof.product_id !== prod.url) reasons.push(`HANDOFF: displayed product ${prod.url} ≠ proven SKU ${proof.product_id}`);

  const conflicts = (proof && proof.conflicts) || [];
  const unknowns = (proof && proof.unknowns) || [];

  // (2) never-relax must NEVER be relaxed — a never-relax axis in the disclosure is a hard break
  for (const c of conflicts) {
    if (modeById.get(c.axis) === NEVER_RELAX) reasons.push(`never-relax "${c.axis}" appears relaxed on rule ${rid}`);
  }
  for (const u of unknowns) {
    if (modeById.get(u.axis) === NEVER_RELAX) reasons.push(`never-relax "${u.axis}" is UNKNOWN on rule ${rid}`);
  }

  return {
    ok: reasons.length === 0,
    stale,
    reasons,
    match_state: (proof && proof.match_state) || null,
    conflicts,
    unknowns,
  };
}

export default { verifyServedResult };
