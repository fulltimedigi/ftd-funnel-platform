# ADR-0060 — The Certifier (phase 2): tree↔runtime equivalence, real mint rate, kernel-side certificate

- **Status:** Accepted (phase 2 built + proven, red-first). STOPPED at stop-point 3. Delivery/render/wiring NOT
  started.
- **Date:** 2026-07-28
- **Related:** ADR-0059 (compiler), `engine/kernel/certifier.js`, `tests/certifier.equivalence.test.mjs`,
  `docs/KNOWN-GAPS.md` (GAP-7), consultation round-10.

## What was built
`engine/kernel/certifier.js` — decides whether a compiled artifact is actually runnable by **re-deriving**,
never by trusting the compiler's receipts.
- `certify(cinput, ctx)`: for every leaf, walks the accumulated answers, re-runs the KERNEL from scratch
  (`classifyUnit` + `select`), and compares the re-derivation to the artifact's receipt — state, counts, and
  the fully-determined pick ∈ the re-derived pool. Any divergence ⇒ the leaf is unresolved.
- `makeCertificate(tally, versions)`: the certificate CONSTRUCTOR, kernel-side (monopoly). Minted ONLY when
  `checked = certified = valid_terminals = expected > 0 ∧ unresolved = 0`; refuses otherwise.

## Stop-point-3 scorecard (the moment of truth — all numbers as-is)
- **Tree↔runtime equivalence:** re-derivation matches the artifact on **11/11 leaves** (mismatched = 0).
- **REAL MINT RATE = 100%** (11/11). The artifact faithfully represents the kernel — no softening was needed
  (pledge 2 held; nothing was edited to raise the number).
- **The three invariants (artifact-acceptance):**
  - **I1 NoDeadEnd = GREEN** (every leaf servable — state ≠ HONEST_NO_MATCH; all 11 are EXACT_AVAILABLE).
  - **I2 InputCompleteness+Provenance = GREEN** (every leaf's SelectionResult fully kernel-determined; every
    semantic field traces to a kernel receipt).
  - **I3 NoActiveSKUWithoutAccountingOrWitness = RED (61/80)** — **EXPECTED and correct**, not a defect: 19
    active SKUs are neither surfaced@cap nor grid-accounted (GAP-7 not built) nor witnessed. **It blocks
    PUBLISH, not measurement, and not the certificate.** Shown red, not fixed (pledge 3).
- **The certificate:** ISSUED (equivalence holds). `expected=11 checked=11 certified=11 unresolved=0 · terminal=0
  display=11`. Versions: `policy=oud_pol_1 · compiler=cinput-1 · kernel=k_1 · artifact=9b685367 ·
  catalog[structural=oud_cat_1, runtime=oud_runtime_1]` (structural version ⇒ STALE on change; runtime version
  ⇒ the honest display layer). Constructor kernel-side.
- **Pledge 1 proven:** tampering a leaf receipt (a lie the kernel contradicts) is caught by re-derivation ⇒
  `unresolved > 0` ⇒ the kernel-side constructor REFUSES the certificate.

## Finding during the build (review discipline, round 2)
| finding | classification | detail | blocks stop-point? |
|--------|----------------|--------|--------------------|
| the certificate's `terminal/display` breakdown reads `0/11` because `node_kind` is derived from the whole resolved pool ≤ cap, so a leaf with a decisive **1 EXACT pick + alternates** (state EXACT_AVAILABLE) is labeled `display`, not `terminal` | **QUALITY** (a labeling boundary; no effect on mint / equivalence / invariants / certificate issuance) | the underlying state distribution is `{EXACT_AVAILABLE: 11}` — the funnel IS decisive; recommend deriving `terminal` from EXACT ≥ 1 rather than resolved ≤ cap | **no** — logged to backlog; a quality change goes there per the review discipline, not fixed mid-phase |

No safety/integrity finding arose. Two review rounds are now spent on this component (compiler = round 1,
certifier = round 2) — per the discipline, round 3 accepts only proven safety/integrity.

## Consequences
- The pipeline is now end-to-end **verifiable**: tree → compiler → CertificationInput → Certifier
  (re-derivation) → certificate. Mint 100% today on oud. Publish is correctly BLOCKED by GAP-7 (I3) until the
  ق20 grid is built.
- Full suite green; gold pins unchanged.

## Files
`engine/kernel/certifier.js` (new) · `tests/certifier.equivalence.test.mjs` (new, red-first). **Not touched:**
delivery, render, ingestion, wiring; the frozen axis-selector v10; gold.
