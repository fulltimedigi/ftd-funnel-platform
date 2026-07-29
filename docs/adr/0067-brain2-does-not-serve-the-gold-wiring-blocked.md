# ADR-0067 — BLOCKING: brain2 does not serve the frozen gold (production wiring paused at step 3.1)

- **Status:** Accepted as a BLOCKING FINDING. Delivery step 3 is **paused at part 1** (measure-first). The emitter
  + wiring (parts 2–4) are **not** built — building them on brain2 as-is would wire a regression. Pull/SSRF
  untouched. Gold frozen; **not fixed** (frozen-gold pledge).
- **Date:** 2026-07-29
- **Related:** ADR-0066 (pipeline factory + plan), `tests/brain2.remeasure.test.mjs`, `tests/brain.remeasure.test.mjs`,
  `tests/lib/evalScorer.mjs`, `authoring/brain2/tree.js`, `docs/standards/certified-pipeline-contract.md`,
  consultation round-12 (delivery step 3, part 1).

## Context — measure-first caught a real blocker
The six numbers **11/11·0·0** were measured on `authoring/brain` (`decisionTree.js`), NOT on `authoring/brain2`
(the tree the structural compiler consumes). Before wiring brain2 into production, the operator required measuring
**brain2** on the same frozen gold — and letting that number, not brain's, be the step-6 target. The measurement
is decisive.

## Measurement (frozen gold, `tests/brain2.remeasure.test.mjs`, faithful traversal mirroring brain's semantics)
| number | brain2 | brain (target) |
|---|---|---|
| exact_fulfillment | **2** | 11 (= ceiling) |
| honest_no_match | 6 | — |
| disclosed_compromise | 4 | — |
| silent_compromise | **9** | 0 |
| hard_violation | 0 | 0 |
| false_no_match | **6** | 0 |
| unserved | **25 / 27** | ~0 |

brain2 does **not** meet brain's numbers. The gap is large and it is **structural, not an adapter artifact**.

## Root cause (facts read off brain2's tree, independent of the scorer)
- **ق2 mandatory "any" reachability branches = 0.** brain's tree adds a mandatory `{value:"any"}` branch at each
  soft-axis node (ق2 — an unknown/"don't care" answer stays reachable). brain2's `buildFullTree`/v10 emits **only
  specific-value branches**, so a shopper who answers "any"/skips a soft axis **cannot route**. The gold has **9
  origin="any" intents**; 6 of them dead-end at an origin question with no "any" branch.
- **No ceiling budget; no "low" band.** brain2 offers budget bands **{mid, high} only**, matched **band-exact**
  (not "≤ ceiling"). The gold's `budget_ceiling` is a **ceiling** (0/1/2) with 9 low-budget intents; 3 dead-end
  with `value-not-offered: budget=low`, and band-exact vs ceiling mis-serves others.
- Unrouted tally: `{ no-wildcard-branch:origin: 6, value-not-offered:origin: 3, value-not-offered:budget: 3 }` = 12
  intents structurally unroutable; the rest degrade to silent/false-no-match.

## Decision
1. **Do NOT wire brain2 into production yet.** It is a *different, less-complete* tree; wiring it would regress the
   six numbers from 11/11·0·0 to 2/·/9/·/6/25. That is precisely the "numbers move for the wrong reason / someone
   tunes to a number that isn't brain2's" failure the measure-first step exists to prevent.
2. **Do NOT fix it in this step.** The frozen-gold pledge stands: the difference is **shown**, not treated. Fixing
   brain2's tree (adding ق2 "any" branches + a ceiling budget) is a separate, red-first build the operator rules on.
3. **Record the real step-6 target.** It is brain2's number *after* its tree is completed — not brain's 11. Until
   then, step 6 has no honest target and the delivery cannot claim "the numbers moved through production."
4. **Scope note (why not build the brain-agnostic emitter anyway):** the emitter/wiring turn the contract test
   green by producing a CertifiedArtifact from *whatever* tree brain2 yields — but that artifact would serve
   2/27 exact. Shipping the certified-but-regressed funnel to make a test green is exactly gaming the outcome.
   The emitter is built only once brain2 serves the gold.

## Consequences
- The pipeline factory (ADR-0066, step 2) stands — the un-forgeable assembler is still correct and green.
- The delivery's critical path now runs **through brain2's tree completeness**, discovered *before* any wiring —
  the cheapest possible place to catch it.
- Not touched: axis-selection **rule** (frozen — this is about tree *reachability/ceiling*, a separate concern),
  gold, kernel, pull/SSRF. Nothing softened.

## Open question for the operator (a real fork, with a recommendation)
brain2's tree needs two capabilities brain's tree already has: **(a) ق2 mandatory "any" branches** and **(b) a
ceiling budget axis** (variant-level, as the certifier already does — ADR-0063). **Recommendation:** add both to
`buildFullTree` as a red-first build (target = brain2 matches brain's 11/11·0·0 on the gold), *then* resume step 3
(emitter + wiring). This keeps the certified chain but earns the numbers honestly.
