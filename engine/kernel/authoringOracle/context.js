/**
 * engine/kernel/authoringOracle/context.js — EvaluationContextRef (Kernel Authoring Oracle, ADR-0046).
 * ===========================================================================================
 * The context an evaluation is bound to: the three VERSIONS that pin what "matching" meant at the
 * moment of evaluation — `structural_catalog_version` (which catalog snapshot), `policy_version`
 * (which numbered matching policy), `kernel_version` (which matcher build). It carries VERSIONS
 * ONLY — never catalog data, never answers, never a `mode` (a projection deletes fields, it never
 * adds a mode flag). Frozen, so a caller cannot mutate the context an evaluation was minted under.
 */

export function makeEvaluationContext({ structural_catalog_version, policy_version, kernel_version } = {}) {
  if (!structural_catalog_version || !policy_version || !kernel_version) {
    throw new Error("EvaluationContextRef requires structural_catalog_version, policy_version, kernel_version (fail-closed — an unversioned evaluation is not reproducible)");
  }
  return Object.freeze({ structural_catalog_version, policy_version, kernel_version });
}

export default { makeEvaluationContext };
