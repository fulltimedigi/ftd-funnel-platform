# ADR-0044 — Certified-pipeline types + fail-closed load re-verification

- **Status:** Accepted (step 3 of the certified-pipeline build; steps 4–5 pending)
- **Date:** 2026-07-27
- **Part of:** `docs/standards/certified-pipeline-contract.md`

## Context

Contract §3 requires three types — `AuthoringIR → CertificationInput → CertifiedArtifact` — with two
structural guarantees. The most important is a security one the operator named precisely: a private
minting constructor is **not enough**, because the artifact is persisted and re-read as JSON — any file
can write `{"artifact_kind":"CERTIFIED_ARTIFACT"}`. The real recurring threat is **"we produced an
artifact that CLAIMS certified without ever passing the kernel"** — it has recurred five times.

## Decision

`engine/kernel/pipelineTypes.js`:
1. **`assertNoSelection(obj)`** — a pre-certification type (AuthoringIR / CertificationInput) may carry
   ONLY structure (questions, options, `axis_refs`, `constraint_refs`, tree, `terminal_policy_refs`).
   Any selection field (`match_state`, `proof`, `scores`, `matched_skus`, `candidates`, `winner`, …)
   throws — a matcher before the kernel is forbidden (contract §3 / §6).
2. **`loadCertifiedArtifact(json, catalog)`** — FAIL-CLOSED across the JSON boundary. `artifact_kind` is
   **untrusted**; the artifact is **re-verified through the kernel** (`verifyFunnel`) and accepted only
   if the VerificationReport passes (which itself requires `expected_count > 0`, ADR-0043). A forged
   `{artifact_kind:"CERTIFIED_ARTIFACT"}` with no kernel proof is **rejected on load**.

The CertifiedArtifact **minting** constructor lives only in the kernel certifier (built in step 4, with
the structural compiler + Kernel Authoring Oracle); this module is the type contract + the load boundary
that protects it.

## Consequences

- `tests/pipeline-types.test.mjs`: a forged artifact (empty table OR proofless COMMERCE rule) is rejected
  on load; a real kernel-verifiable config loads across serialization; an AuthoringIR carrying any
  selection field is rejected. Full suite green (90).
- **Recorded follow-up (operator, mandatory before hosted embed at a merchant):** a **digital signature**
  (public/private key) so the artifact can cross a trust boundary; load re-verification covers the
  in-house threat, signing covers the cross-boundary one.
- **Pending (steps 4–5):** the Kernel Authoring Oracle (`evaluateCandidate` / `evaluateOperationalEligibility`),
  rebuilding the decision tree from scratch via the oracle, the three named invariants
  (`NoPublishedPathViolatesHardConstraints`, `UnresolvedPublishedConflicts=0`,
  `NoActiveSKUWithoutAccountingOrWitness`), and the nine-number re-measure on frozen gold.
