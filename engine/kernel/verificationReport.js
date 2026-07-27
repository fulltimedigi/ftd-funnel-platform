/**
 * engine/kernel/verificationReport.js — the INDEPENDENT verification library (ADR-0043).
 * -------------------------------------------------------------------------------------------------
 * A safety verifier must NOT return a bare boolean — a bare boolean hides the ".every([]) === true"
 * empty-set lie (an absent decision table "passed" because there was nothing to check). Instead every
 * certificate-layer verifier returns a VerificationReport of COUNTS, and `ok` is DERIVED here, in one
 * place, by an explicit conjunction that REQUIRES a non-empty expected set. Vacuous truth cannot pass.
 *
 * VerificationReport = {
 *   expected_count,   // how many reachable claims MUST be verified (0 ⇒ nothing to certify ⇒ FAIL)
 *   observed_count,   // how many were actually present to check
 *   checked_count,    // how many the verifier actually inspected
 *   passed_count,     // how many passed
 *   failed_count,     // how many findings/failures
 *   skipped_count,    // expected but not checked
 *   missing_ids,      // expected ids that were absent
 *   failures,         // [{ rule, criterion, msg }] — the actual findings
 * }
 */

/** The ONE place `ok` is derived. FAIL-CLOSED on an empty expected set (expected_count === 0). */
export function deriveOk(r) {
  return !!(
    r &&
    r.expected_count > 0 &&                       // ← closes the empty-set vacuous-truth hole
    r.observed_count === r.expected_count &&
    r.checked_count === r.expected_count &&
    r.passed_count === r.expected_count &&
    r.failed_count === 0 &&
    r.skipped_count === 0 &&
    (!r.missing_ids || r.missing_ids.length === 0)
  );
}

/** Assemble a report from parts and stamp its derived ok. Verifiers call this so the shape is uniform. */
export function makeReport({ expected_count = 0, observed_count = 0, checked_count = 0, passed_count = 0, failed_count = 0, skipped_count = 0, missing_ids = [], failures = [] } = {}) {
  const report = { expected_count, observed_count, checked_count, passed_count, failed_count, skipped_count, missing_ids, failures };
  report.ok = deriveOk(report);
  return report;
}

export default { deriveOk, makeReport };
