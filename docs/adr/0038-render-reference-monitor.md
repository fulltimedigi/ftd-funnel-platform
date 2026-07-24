# ADR-0038 — Render-time reference monitor (P0 correctness, Commit 1)

Status: Accepted · 2026-07-24 · closes the render-time gap found by `audits/CODE-AUDIT-round1.md`
and designed in `CODE-AUDIT-round2-fix-plan.md` (both on branch
`claude/project-review-assessment-oj8azk`). Trust / anti-bland / richness gates untouched.

## Context

The ADR-0037 contract was proven at PUBLISH time (`verifyFunnel` re-runs the independent reference
evaluator over every rule) but was **not enforced at RENDER time**: the runtime was warn-not-suppress
(a failed cert appended a ⚠ line but still shipped the card + buy CTA), the version-coherence check
never ran at render, the proofless `r_default → overall` fallback could render a global-best product,
and `safety.js` / `handoff.js` were unit-tested but **unwired**. The audit's one-sentence root cause:
the kernel was an *authoring-time prover*, not a *runtime gate*.

## Decision — complete mediation at render

A confident product card + CTA without a valid runtime certificate **for the exact displayed SKU** is
made **structurally unrepresentable** (`engine/kernel/certifyForRender.js`):

- The renderer accepts exactly one of: a **Symbol-branded `CertifiedSelectionResult`** (minted only
  by `certifyForRender`, in memory — the seal is module-private, never exported, never serialized), or
  a **`TerminalOutcome`** ∈ { NO_MATCH | STALE | RESTART_REQUIRED | HANDOFF_UNBOUND | INVALID_ARTIFACT }.
  Both are first-class, mandatory render states — never a card plus a footnote. `isCertified()` guards
  the product card; a forged plain object can never pass it (the seal is private).
- `certifyForRender` is fail-closed and demands mandatory inspection receipts, each from its own
  verifier: **proof** (a ProvenSelection for this path — a proofless fallback yields NO_MATCH, closing
  the forbidden global fallback AT RENDER), **versions** (the five stamps the client loaded must match —
  any drift → STALE; this WIRES the coherence check into render), **presentation** (one
  CanonicalOfferRecord — title/image/price/url from the same proven SKU, never composited), **handoff**
  (`handoff.js`: the CTA is the proven product/variant url, never a parent/brand-home fallback →
  HANDOFF_UNBOUND when unbindable), and **safety** (`safety.js`: PASSED_NOT_APPLICABLE when no safety
  axis — an explicit pass, never "skipped"). This is what wires `safety.js` + `handoff.js` in for real.
- **Alternates** are each certified independently; an uncertified alternate is dropped, never drawn.
- `verifyServedResult` is now internal — called ONLY from `certifyForRender`; the renderer no longer
  calls it directly (the advisory/warn path is deleted). A `render-architecture` lint test fails CI if
  that boundary is ever re-opened or the seal is ever exported.
- **AI grounding → advisory (audit #5 / #13):** validating "real url + in-domain value" verifies FORM,
  not truth, so the `ai-validated` SAT label is removed. AI-designed axes are now **ADVISORY** — a
  disclosed preference that ranks AFTER the verified promises, **never makes a result EXACT**, and can
  never be a hard filter. Grounding uses **whole-word** matching (no "soil"⊃"oil", "women"⊃"men").

## Scope of this commit (honest)

CLOSED, each locked by a production-entry E2E test that fails if reverted
(`tests/certified-render.e2e.test.mjs`, `tests/render-architecture.test.mjs`):

- render-time complete mediation (#1); version coherence at render (#2); proofless fallback → terminal
  at render (#3); safety + handoff wired as receipts, CTA = proven SKU (#4); uncertified alternates
  never drawn (#8); AI inference → advisory/UNKNOWN, whole-word grounding (#5, #13). Poison-canary:
  breaking the handoff guard turns the card into a terminal (a CI reddener).

DEFERRED to a follow-up commit, with the exact blocker recorded — do NOT claim these are closed:

- **Budget bound = 1 tier as an enforced cap + matcher/verifier reading it from a numbered policy
  registry, and the authoring-side discriminated union (COMMERCE | TERMINAL) that produces first-class
  NO_MATCH cells (#6, #3-authoring).** BLOCKER: enforcing cap=1 creates honest NO_MATCH answer-cells,
  which the existing **trust gate** (`trustValidate.js`) classifies as *dead-ends* and rejects — and
  this ADR is under a hard "do not touch trust/anti-bland/richness" constraint. Closing #6 requires the
  operator to authorize making the trust gate **TERMINAL-aware** (a NO_MATCH cell is an honest terminal,
  not a dead-end). A prototype of the full cascade was built and reverted to keep the suite green; it is
  ready to re-land the moment the trust-gate change is authorized. (The render gate still refuses to
  render any over-relaxed result whose proof fails re-verification, so the shopper-facing risk is
  bounded even before #6 lands.)
- Ambiguous-product UNKNOWN≠OTHER handling and the coverage-denominator report (#10) ride on the same
  discriminated-union work and are deferred with it.

## Consequences

- The shopper-facing guarantee now holds where the shopper actually is: a card + CTA renders only for a
  branded certificate whose displayed SKU is the proven SKU, versions cohere, and handoff is bound;
  everything else is an honest terminal screen. The reference monitor gates every KERNEL-AUTHORED
  commercial funnel; curated hand-built reference configs (no proofs) keep the legacy path, trusted
  through trust + anti-bland.
- All **65** suites green; trust / anti-bland / richness untouched. Preview only; no PR. Security
  (Commit 2) is a separate change.
