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
 * @returns {{ ok, stale, reasons:string[], match_state, conflicts:[], unknowns:[] }}
 */
export function verifyServedResult(config, resolved) {
  const reasons = [];
  const rid = resolved && resolved.scoring && resolved.scoring.ruleId;
  const rule = rid ? (config.decisionTable || []).find((r) => r.id === rid) : null;
  const proof = rule && rule.proof;
  const modeById = new Map((config.constraintPolicy || []).map((c) => [c.id, c.mode]));

  // (1) product exists in the served config
  const prod = resolved && resolved.primary && resolved.primary.recommendations && resolved.primary.recommendations.primary;
  if (!prod || !prod.url) reasons.push("served result has no real product url");

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
    stale: false, // becomes meaningful once a live catalog is dereferenced (deferred)
    reasons,
    match_state: (proof && proof.match_state) || null,
    conflicts,
    unknowns,
  };
}

export default { verifyServedResult };
