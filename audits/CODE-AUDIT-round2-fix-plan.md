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

## PROMPT A — P0 correctness (the certified render gate)
(see chat; also the authoritative text the round-2 session must follow)

## PROMPT B — P0 security (fail-closed)
(see chat)
