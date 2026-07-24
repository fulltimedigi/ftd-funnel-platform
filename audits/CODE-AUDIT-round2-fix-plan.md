# Code Audit — Round 2 fix plan (from 3 converging external reviews)

## The architecture decision (unanimous across 3 reviewers)
**Reference monitor / complete mediation.** Move from "prove once at publish, then trust every
renderer" to "prove at publish, **completely mediate at render**." The bad state — a confident
product card/CTA without a valid runtime certificate for the exact displayed SKU — becomes
**structurally unrepresentable**, not merely warned about.

- The renderer accepts exactly ONE input type: a kernel-minted `SelectionResult` (a "certified
  offer"). Not raw archetype config, not a raw catalog product, not a table rule, not
  {id + independently-supplied price/url}.
- Exactly ONE fail-closed constructor (`certifyForRender`) mints it. In JS (no TS) the type carries
  a **module-private Symbol brand**; the renderer refuses any object lacking the brand. Enforcement
  is runtime-brand-check + architecture/lint tests (types would do this in TS).
- Verification failure returns a **first-class terminal outcome** the renderer is OBLIGED to draw:
  `NO_MATCH | STALE | RESTART_REQUIRED | UNVERIFIED | HANDOFF_UNBOUND`. Never a card + warning.

## Definition of DONE (process fix — the recurring "built, tested, unwired" pattern)
A finding is CLOSED only when a **production-entry end-to-end test** fails if the fix is reverted.
Unit-green on an unimported module is NOT done. Add: E2E render tests through the real entry, a
**poison-canary** CI job (deliberately break a guard → suite MUST go red), and dependency-graph lint.

## Priority
- **P0-correctness** (Prompt A): the certified render gate + budget-bound/verifier-independence +
  AI-grounding→UNKNOWN + kill proofless fallback. Close before claiming the contract holds.
- **P0-security** (Prompt B): fail-closed secrets, unguessable ids, canonical-IP SSRF, endpoint tests.
  Close before the next deploy.
- **P1** (later): wire safety into mandatory receipts; reduce `simTo` to a proposal generator that
  must pass the kernel; fix ambiguous-format orphaning + coverage denominator.
- **P2** (honest deferral): metrics wiring, dead-code/dup cleanup, live inventory. *Scope note:
  deferring the `simTo` dedup is safe ONLY because the independent verifier catches any divergence
  from the kernel at publish time.*

---

## Final corrections applied (2 external reviews)
- UNVERIFIED is a match_state of a REAL product, NOT a terminal. Terminal = NO_MATCH | STALE |
  RESTART_REQUIRED | HANDOFF_UNBOUND | INVALID_ARTIFACT.
- The artifact stores a serializable ProvenSelection; the Symbol-branded CertifiedSelectionResult is
  minted in-browser by certifyForRender only (Symbol never serialized).
- Budget bound: ONE independent numbered policy registry; matcher + verifier each read
  maxBudgetTierDistance=1 and derive independently; NEVER pass an effective bound matcher→verifier;
  literal only inside a canary test.
- Ambiguous product: UNKNOWN != OTHER; resolve/merchant/exclude-with-reason; "other" only if
  positively proven outside known values — never for missing data; don't reject the funnel if the
  exclusion is honest and coverage holds.
- CanonicalOfferRecord (product- and variant-level fields with provenance); no composing across offers.
- Close the advisory path (verifyServedResult internal-only; no {warning, product}).
- Any post-certification override of product_id/variant_id/price/image/cta_url/availability = a
  programming error / render refusal, not a silent downgrade.
- Security: public job id = randomUUID + internal dedup HMAC(salt,url); timingSafeEqual on
  fixed-length digests; SSRF must connect to the verified IP (pin, preserve Host/SNI) — resolve-then-
  fetch is not enough; cost cap must use CAS, not documentation; CSP frame-ancestors = required
  origins only, not open wildcard. Two commits (correctness, then security); full suite after each.

The authoritative final prompts (A correctness, B security) were relayed to the round-2 session.
