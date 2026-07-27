# ADR-0043 — Safety verifiers return a VerificationReport; `ok` is derived, fail-closed on empty

- **Status:** Accepted
- **Date:** 2026-07-27
- **Part of:** the certified-pipeline contract (`docs/standards/certified-pipeline-contract.md`), Part-4B step 1

## Context

Measuring the new P1 brain's artifact against the publish gate as-is (read-only) exposed a hole:
`verifyFunnel` returned a bare boolean `ok = findings.length === 0`. On an **absent/empty decision
table** there are zero rules to check → `findings` is empty → `ok === true`. `recordFrom` then persisted
the artifact **READY**. So the brain artifact (a tree, no decisionTable, no proofs) would have **passed
the publish gate vacuously** and served a funnel whose every path is a dead-end — the same
`.every([]) === true` empty-set lie caught earlier in the P1 brain work.

## Decision

A safety verifier must NOT return a bare boolean. It returns a **VerificationReport of counts**
(`expected_count, observed_count, checked_count, passed_count, failed_count, skipped_count, missing_ids,
failures`), and `ok` is **derived in one independent library** (`engine/kernel/verificationReport.js`)
by an explicit conjunction that **requires a non-empty expected set**:

```
ok  ⇔  expected_count > 0
     ∧ observed_count === expected_count
     ∧ checked_count  === expected_count
     ∧ passed_count   === expected_count
     ∧ failed_count   === 0
     ∧ skipped_count  === 0
     ∧ missing_ids    === []
```

`verifyFunnel` now builds this report (expected = the reachable COMMERCE+TERMINAL rules, excluding the
`when:{}` default) and returns `ok = deriveOk(report)` alongside back-compat fields. An empty/absent
decision table ⇒ `expected_count === 0` ⇒ **ok false** ⇒ the publish gate blocks it.

## Consequences

- **Verified end-to-end:** the brain artifact now yields `verifyFunnel.ok = false` and
  `recordFrom.status = "error"` (was `true` / `"ready"`). Vacuous truth can no longer pass the gate.
- **Mutation tests** (`tests/verifyreport.mutation.test.mjs`) kill the lie: empty table, zeroed checked,
  broken expected, skipped, failure, and `makeReport({})` all force `ok` false; a well-formed funnel
  passes. If any mutation stays green, the empty-set lie is back.
- No existing caller broke (every real funnel has `expected_count > 0`); full suite green (88).
- **Follow-up (recorded):** extend the report shape to the other certificate-layer verifiers
  (`verifyServedResult` and any future safety verifier) so none returns a boolean-only result.
