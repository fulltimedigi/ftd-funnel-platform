# ADR-0039 — The COMMERCE | TERMINAL discriminated union, and a TERMINAL-aware trust gate

- **Status:** Accepted
- **Date:** 2026-07-24
- **Supersedes/closes:** the two deferrals in [ADR-0038](0038-render-reference-monitor.md) (budget
  cap=1 enforcement + the discriminated union; ambiguous-UNKNOWN handling + coverage denominator).
- **Builds on:** ADR-0034 (format hard), ADR-0035 (budget hard), ADR-0037 (constraint kernel), ADR-0038
  (render reference monitor).

## Context

ADR-0038 closed the *render* gate — a product card + buy CTA is structurally unrepresentable without a
branded certificate for the exact proven SKU — but had to **defer** the *authoring/table* half:

1. **Budget cap = 1 tier could not be enforced.** Turning cap=1 on creates honest **NO_MATCH** answer
   cells (a form×tier the catalog can't fill within one tier). The existing **trust gate**
   (`trustValidate.js`) classified any cell that resolves to no product as a **dead-end** and rejected
   it — and ADR-0038 ran under a hard "do not touch trust/anti-bland/richness" constraint. So cap=1 and
   the honest NO_MATCH it implies were blocked on a trust-gate change nobody was authorized to make.
2. Consequently the **discriminated union** (a rule is either a proven product or an honest ending) could
   not be activated in the table, and the **ambiguous-product UNKNOWN** handling + coverage denominator
   rode along with it.

The operator then **explicitly authorized ONE change to trust**: make it *understand* honest terminals
**without weakening its teeth** — and *only* that. No touching anti-bland or richness; no regression on
ADR-0037/0038.

## Decision

### 1. Every decision-table rule is a discriminated union

```
Rule = CommerceRule | TerminalRule

CommerceRule { kind:"COMMERCE", when, result, proof: ProvenSelection }
TerminalRule { kind:"TERMINAL", when,
               terminal_state: NO_MATCH | RESTART_REQUIRED | STALE | HANDOFF_UNBOUND | INVALID_ARTIFACT,
               reason_code, message_key,
               next_action: START_OVER | EDIT_ANSWERS | REFRESH | BROWSE_CATALOG,
               terminal_proof?  // MANDATORY for an authoring-time NO_MATCH }
```

- A cell with no product within the constraints is a **first-class NO_MATCH terminal**, never routed to a
  global "best" product. The `when:{}` default is **TERMINAL only** (`RESTART_REQUIRED`) — a `when:{}`
  COMMERCE rule is a forbidden global product fallback.
- `match_state ∈ {EXACT, COMPROMISE, UNVERIFIED}` are **all valid COMMERCE product results**. **UNVERIFIED**
  (a real product whose uncertain attributes are *disclosed*) is a valid COMMERCE outcome — **never**
  rejected, **never** converted to a terminal.

### 2. Trust is TERMINAL-aware — and keeps every tooth (`engine/trustValidate.js`)

A path is **trusted** iff it ends as **(1) COMMERCE** — a proven SelectionResult, all NEVER_RELAX SAT,
every field + link from one CanonicalOfferRecord — **or (2) an honest TERMINAL** — a known state, with a
`reason_code` + `message_key`, an actionable `next_action`, **no** product/variant/price/image/buy CTA,
and (for an authoring NO_MATCH) a `terminal_proof`. Trust still **rejects**: a path that is neither; a
TERMINAL with no `next_action` (a blank screen) or no `terminal_proof`; a COMMERCE rule with no proof; a
`when:{}` COMMERCE default; a terminal that carries a product. This is the *only* trust change.

### 3. Budget cap = 1 tier, from a numbered policy registry (`engine/kernel/policyRegistry.js`)

`maxBudgetTierDistance = TierDistance(1)` (a **TierDistance**, never a **TierCount**). The **matcher**
(`constraintKernel.eligibility`) and the **independent reference evaluator**
(`referenceEvaluator.isEligible`) each read this registry with their **own** code — **no effective bound
is ever passed matcher → verifier** (audit #6). A fault-injection test feeds a matcher an over-relaxed
(2-tier) pick while the policy stays 1; the verifier independently rejects it.

### 4. UNKNOWN on a NEVER_RELAX axis excludes with a reason — never auto-OTHER

A product whose value on a NEVER_RELAX axis (e.g. **format**) is UNKNOWN (absent or ungrounded) is
**excluded from the eligible SKUs** for a specific value of that axis, with a recorded reason — never
mapped into an "OTHER"/any bucket, and the filter is never weakened. Coverage is reported against the
**eligible** denominator (`excludedSkuReport`, surfaced in `authorFunnel().meta.excludedSkus`).

### 5. Safety is honestly scoped

`engine/kernel/safety.js` is now **wired** as the single safety-axis detector (`isSafetyAxis`) at both
authoring and render. Because the official-evidence pipeline (`resolveSafetyEvidence`) is **not** plumbed
into ingestion yet, publishing any **safety/allergen/compatibility/legal** axis is **explicitly BLOCKED**
at authoring (`reason:"safety-axis-unsupported"`) until that grounding exists. We do not ship a safety
promise we cannot ground from an official source. **This is an explicit open item, not a silent gap.**

## Verification (real synthetic stores, `npm test` = 586 assertions green)

Per-store table shape under cap=1 (COMMERCE = EXACT/COMPROMISE/UNVERIFIED; terminals separated):

| Store | Products | COMMERCE (E/C/U) | NO_MATCH | RESTART | Proof cov. | Excluded SKUs | Trust | verifyFunnel |
|-------|----------|------------------|----------|---------|-----------|---------------|-------|--------------|
| oudfactory | 20 | 33 (18/15/0) | **3** | 1 | 100% | 0/20 | PASS | OK |
| laptops | 12 | 24 (20/4/0) | 0 | 1 | 100% | 0/12 | PASS | OK |
| coffee | 10 | 27 (18/9/0) | 0 | 1 | 100% | 0/10 | PASS | OK |

- **oudfactory's 3 NO_MATCH terminals** are the honest fruit of cap=1: form×tier cells more than one tier
  from any same-form product. They carry a reason + `next_action:EDIT_ANSWERS` + a `terminal_proof`.
- **UNVERIFIED = 0** in these fixtures because every attribute is grounded — reported honestly, not hidden.
- **Excluded SKUs = 0** because every product's format resolves deterministically; the machinery and
  report exist and fire the moment an ambiguous product appears.

**Teeth (tests/trust-terminal.test.mjs, 15 assertions):** an honest NO_MATCH passes; a terminal with no
`next_action`, no `terminal_proof`, or a product all FAIL; a proofless COMMERCE FAILS; a `when:{}` COMMERCE
default FAILS; UNVERIFIED PASSES as COMMERCE; a real dead-end (missing archetype) still FAILS; a missing
answer → RESTART_REQUIRED; the >1-tier overshoot is unprovable as COMMERCE and provable as NO_MATCH; a
**fabricated** NO_MATCH (an eligible unit exists) is caught. **E2E (tests/certified-render.e2e.test.mjs):**
a fired NO_MATCH terminal renders a terminal screen — no card, no CTA — and reverting each guard re-draws
a card (the fix is closed only because its revert reddens CI).

## Consequences

- The guarantee is now end-to-end: the table can only ever hand the renderer a **proven product** or an
  **actionable honest ending**; the renderer can only draw a card for a branded certificate. No global
  fallback survives at authoring **or** render.
- The runtime trust gate catches a *dead* question; the anti-bland gate (untouched) catches a *mirror*
  question; richness (untouched) catches thinness — all still green, no regression.
- **Open, explicit:** safety/allergen/compatibility/legal axes are blocked at authoring until an
  official-evidence pipeline lands. Until then, "P0-correctness is closed; safety enforcement is scoped
  out by an explicit publish block, not silently assumed."
