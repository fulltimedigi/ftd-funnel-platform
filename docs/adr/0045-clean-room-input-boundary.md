# ADR-0045 — Clean-room input boundary for the brain rebuild (step 4-a0)

- **Status:** Accepted (step 4-a0; oracle/rebuild pending)
- **Date:** 2026-07-27
- **Part of:** `docs/standards/certified-pipeline-contract.md` §4-a0

## Context
The P1 brain will be rebuilt from scratch via the Kernel Authoring Oracle. The old brain's decision tree
was built BY the second matcher, so pruning its branches keeps the structure contaminated (§4-b). The
rebuild must therefore run in a **clean room** that cannot inherit the old outputs — not by imports, and
not by DATA (a legacy leaf/table/profile smuggled in as data is contamination too).

## Decision
`authoring/brain2/cleanRoom.js` (new namespace). `buildInputManifest(sources)` is FAIL-CLOSED:
- **Allowlist** of primary sources only: raw_catalog_snapshot · sku_ledger · verified_evidence_links ·
  signed_merchant_exclusions · current_policy · frozen_gold. Any other kind is refused.
- **Data-level forbidden-lineage scan** of each input's content for legacy-matcher keys (decisionTable,
  archetypes, profiles, leaves, exactPath/exactPathTarget, candidatePool, match_state, scores, proof, …).
  A smuggled legacy output is refused even with no import.
- `frozen_gold` is reviewed TRUTH (human-signed) → exempt from the legacy-output scan (its expected
  labels are truth, not a computation), but still kind-checked + hashed.
- Every accepted input is hashed into an InputManifest (provenance); an empty input set is refused.

## Consequences
- `tests/cleanroom.test.mjs` (6 assertions, poison-verified): allowed manifest builds; empty set refused;
  forbidden kind refused; smuggled decisionTable/archetypes data refused; gold truth exempt; the
  forbidden-lineage scanner bites on planted keys. Full suite green (91).
- **Pending (4-a):** the Kernel Authoring Oracle (`evaluateState` → opaque pool refs + counts +
  state_outcome, kernel-minted pools with lineage, six proven invariants, cache keyed incl.
  kernel_version, poison canary on the differential), then the clean-room tree rebuild (§4-b), then the
  three named invariants as build-time validators + certification gates (§4-c), then the numbers (§5).
