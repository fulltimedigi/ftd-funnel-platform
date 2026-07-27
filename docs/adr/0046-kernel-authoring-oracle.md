# ADR-0046 — The Kernel Authoring Oracle (matching is a kernel monopoly; the brain is a thin client)

- **Status:** Accepted (Step 4-a — foundation + seven invariants proven on the full suite)
- **Date:** 2026-07-27
- **Supersedes-in-part:** the implicit assumption that the P1 brain (`authoring/brain/*`) may compute
  matching to shape a funnel. It may not.
- **Related:** ADR-0037 (constraint kernel = single source of truth), ADR-0043 (VerificationReport),
  ADR-0044 (pipeline types / load re-verify), ADR-0045 (clean-room input boundary),
  `docs/standards/certified-pipeline-contract.md` (the binding contract), the constitution (ق9, ق21).

## Context

The P1 brain is built and tested but was never wired to production because wiring it as-is would
create a **second matcher**: if the brain decides *who matches* to shape questions/branches, then the
kernel is no longer the single source of truth (ADR-0037/G1). The certified-pipeline contract fixes
the boundary: **the brain proposes structure; the kernel evaluates and certifies; nothing outside the
kernel may interpret a constraint or test a SKU.** Step 4-a builds the piece that makes this true —
the **Kernel Authoring Oracle** — and proves it against the *real* kernel primitives, in the *real*
repo (a prior isolated-model draft proved the logic but not the ownership/projection contract).

## Decision

Add a kernel-owned oracle under **`engine/kernel/authoringOracle/`** (NOT under `authoring/brain2/` —
if matching logic lived in the brain's folder, a second matcher would exist organizationally):

- **`evaluateState({units, constraints, answers, context})`** — classifies **every** candidate into a
  strict partition `exact ⊎ compromise ⊎ rejected = pool` by orchestrating the kernel's own
  `classifyUnit` (new export on `constraintKernel.js`, reusing the SAME `eligibility` + `matchState`
  the runtime `select()` uses — authoring and runtime cannot diverge). Derives `state_outcome`
  (`EXACT_AVAILABLE | COMPROMISE_ONLY | HONEST_NO_MATCH`) and stamps a **reconstructible**
  `evaluation_hash` (no random ref, no timestamp).
- **`projectForAuthoring(ev)`** — the ONLY thing the brain sees: `state_outcome` + `counts` + **opaque
  pool refs**. It carries no ids, no violation vectors, no evidence, no scores, no ranking, no
  pool_digest. A projection **deletes** fields; it never adds a `mode`.
- **`OracleSession`** — server-side orchestration: kernel-minted **opaque pools** with **MAC'd lineage
  receipts** (`PoolRegistry`, `node:crypto`), an **OracleTranscript** (proof material), a **cache**
  whose identity includes `kernel_version`, and **transitions** (`ROOT | REFINE | BRANCH`) named by a
  kernel-minted `qualified_option_ref`. **Monotonicity is enforced in code:** a `REFINE` may only
  *shrink* the eligible pool — a non-shrinking REFINE throws (the brain must `BRANCH`).
- **`runtimeMembershipDifferential(certified, runtime)`** — the certified pool and the served runtime
  pool must have identical membership; any divergence is a poison canary that bites.

### The governing two-axes correction (mandatory)

`UNVERIFIED` is a **certificate state**, not a match class. Two independent axes:

- **Match classification** — `exact / compromise / rejected` — *who* is chosen (kernel + oracle).
- **Certificate state** — `verified / UNVERIFIED / stale` — *how* a chosen pick is displayed (render).

A `rejected` candidate never reaches display, by any path. An eligible pick whose promise cannot be
grounded is shown **UNVERIFIED with disclosure** (ق9/ق21) — it does **not** disappear and is **not**
folded into `rejected`. Both properties are proven against the real kernel and the real
`certifyForRender` in `tests/oracle.two-axes.test.mjs` (read-only — the render layer is untouched).

## The seven invariants (proven on the full suite, 95 green)

1. **Partition** — `exact ⊎ compromise ⊎ rejected = pool` (`oracle.partition`, `oracle.invariants`).
2. **Projection purity** — the brain projection leaks no roster/vectors/evidence/scores/ranking.
3. **Replay equality** — same legal inputs ⇒ same `evaluation_hash`.
4. **Runtime membership differential** — certified vs runtime membership; a planted poison is caught.
5. **Monotonicity (REFINE only)** — a REFINE shrinks the eligible pool; a growing REFINE throws; a
   BRANCH is exempt.
6. **Overlay isolation** — a merchant bound on one evaluation never leaks into another.
7. **Single Evaluation Origin** — measured by `evaluation_hash`; an independent code path re-derives it
   from the primary inputs alone (no ref, no order-dependence — a shuffle cannot change it).

Plus: kernel-minted opaque pools with MAC lineage (tamper caught), `qualified_option_ref` (a fabricated
ref is rejected), a cache keyed to include `kernel_version`, and the OracleTranscript.

## Consequences

- **Positive:** matching is a kernel monopoly the brain *cannot* violate — not by policy but by
  construction (opaque refs, MAC'd lineage, dependency-graph guard `tests/oracle.dependency.test.mjs`
  that reddens if any `authoring/brain2/` file imports a matching predicate).
- **Server/client split:** the registry, MAC, and transcript are **server-only**; the browser consumes
  a `CertifiedArtifact` and re-verifies via the kernel on load (no registry, no secret shipped).
- **Honest simplifications (recorded, not hidden):** (a) `evaluation_hash` folds only the merchant
  price-overshoot overlay (the sole per-evaluation matching overlay); the budget-tier distance is
  already carried by `policy_version`. (b) A pool's lineage receipt is first-write-wins per
  `evaluation_hash` (two distinct parents refining to the *identical* child state share the first
  lineage) — this is invisible to correctness because the receipt authenticates *membership*, and
  membership is a pure function of the primary inputs; it is noted here so a future BRANCH/REFINE
  provenance requirement knows to key lineage by `(parent, child)` rather than child alone.
- **Not in this step (stop point):** the structural compiler + certifier (4-b/4-c), wiring the brain to
  production, and the variant-picker UI remain deferred. 4-a delivers the oracle and its proofs only.
