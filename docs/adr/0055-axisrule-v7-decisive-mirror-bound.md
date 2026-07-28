# ADR-0055 — Axis-selection rule v7: the decisive mirror bound + minority mirror as a signal

- **Status:** Accepted (implemented + proven); certification + wiring still NOT started.
- **Date:** 2026-07-28
- **Related:** ADR-0054 (`max-info-gain@v6`), `tests/btree.axisrule-v7.test.mjs`, `config/policy.json`,
  consultation round-7.

## Context
Round-7 review found the v6 mirror guard (`Σsᵢ²/S < leaf_total_cap`) **doubly broken**: (1) a **hybrid
denominator** — a numerator conditioned on the grounded options but a denominator (`S`) that includes the u₀
unknowns — systematically *underscores* any sparse-grounding axis, flagging a legitimate soft axis (oud
`origin`, 58% ungrounded) as a mirror 8×; (2) the `leaf_total_cap` threshold **contradicts** `leaf_primary_cap`
(the guard forbids leaving fewer than a grid, but narrowing to 2–3 is the *goal*); and (3) being size-weighted
it is **blind to a minority mirror** (a big bucket + planted singletons scores high yet still hands some
shoppers a mirror). Root cause: **mirror is a SEMANTIC property** (are the axis values product identities?)
that a counts-only brain cannot judge — so any numeric threshold is either over-aggressive or blind.

## Decision — `max-info-gain@v7` (ranking score unchanged)
1. **The single infallible counts bound.** Reject an axis for branching **only when no published option
   isolates >1 item** (`max sᵢ < 2` — every answer pins a single product ⇒ a disguised grid; showing the grid
   is always more honest). **No threshold, no small-pool exemption.**
2. **Minority mirror is a REPORTED signal, not a gate.** `mirror_singleton_share = (#singleton options)/Σsᵢ`,
   surfaced per chosen axis (`tree.mirrorSignals`), and escalated to the **authoring gates** — the place where
   the axis *values* are visible and a semantic mirror can actually be judged.
3. **Two denominators, kept distinct** (each stated: what it measures · denominator · why):
   - RANKING residual `(Σsᵢ²+u₀²)/S` — "how much pool remains?"; the unknown IS a real residual bucket, so it
     is in the numerator and the denominator is the whole node pool `S`.
   - MIRROR share `/Σsᵢ` — "do the published options isolate individuals?"; an unknown is not a revealing
     option, so the denominator is the GROUNDED pool `Σsᵢ`.

## Consequences
- **The v6 origin false-positive is fixed.** oud v6→v7: mirror rejections **8 → 3** (all now genuine
  *all-singleton* nodes, not sparsity artifacts); `surface@cap` **55 → 61** (origin usable again on large
  pools); `depth=2`, `in_candidate_pool=80/80`, `compromise=0%`, **reach ledger clean**. The minority signal is
  reported (`origin@S4=0.5`, `origin@S7=0.2`, others 0) without gating.
- **Red-first** (`tests/btree.axisrule-v7.test.mjs`): the four decisive tests (all-singleton reject · S=2
  reject · [10,1,1] accept · all-size-2 accept); the v6→v7 fix (`[6,6]@S20` v6-rejected, v7-accepted); the
  grounded `/Σsᵢ` mirror denominator; minority-mirror-as-signal; and the ranking keeping u₀ as a real bucket.
- **v7 is NOT over-aggressive:** the generalize catalogs were reverted to the original small distributions —
  all-size-2/3 axes now branch (accepted), only a true all-singleton axis is gated. Generalize green on all
  three catalogs (A: type only · B: budget+origin · C: budget correctly never branched); eight stop conditions
  under v7; full suite green; gold pins unchanged (`gold-1.0.0`, sha OK).
- **The eligible-drop ledger (ADR-0054) is unchanged and still enforced** (`verifyReachability`: exact drop =
  hard fail; compromise drop = recorded-or-fail; unrecorded ⇒ fail).

## Correction recorded
The v6 guard was proposed by review and corrected by review: hybrid denominator (underscored sparse axes) +
threshold contradicting `leaf_primary_cap` + size-weighting blind to a minority mirror. v7 keeps only the
error-free counting decision and moves the semantic judgment to where the values are visible.

## Files
`authoring/brain2/axisRule.js` (`diagnoseAxesV7`/`chooseAxisByInfoGainV7`) · `authoring/brain2/tree.js`
(`RULE_V7` + rejection/signal sinks, default) · `config/policy.json` (`axis_rule_id`, `_v7_mirror_note`) ·
`tests/btree.axisrule-v7.test.mjs` (new) · `tests/btree.{generalize,fulltree}.test.mjs` (SC1 → v7; catalogs
reverted). **Not touched:** compiler/Certifier, render, ingestion, wiring; gold.
