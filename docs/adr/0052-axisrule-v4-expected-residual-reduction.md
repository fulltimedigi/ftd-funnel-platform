# ADR-0052 — Axis-selection rule v4: expected-residual reduction (integer, guarded)

- **Status:** Accepted (rule corrected + proven; certification + wiring still NOT started)
- **Date:** 2026-07-28
- **Related:** ADR-0051 (full tree, `max-info-gain@v3`), `tests/btree.generalize.test.mjs` (the collapse
  detector), `tests/btree.axisrule-v4.test.mjs`, `config/policy.json::authoring_tree`, consultation round-4.

## Context — a collapse the gold corpus could not surface
The thin-generalization gate (ADR-0051 follow-up) rebuilt the full tree on 3 synthetic catalogs with
different axis distributions and ran only the seven stop conditions. It found a **rule collapse** invisible on
oudfactory: the v3 score `N − Σsᵢ²/S` (N = the largest option bucket) is **0 for every uniform partition** —
an ideal even split scores the same as no split at all — so all axes tied at 0 and the **alphabetical**
tie-break branched a **single-value axis** (a question with one possible answer). Root cause: the wrong
baseline (max bucket instead of the pool). Two further defects the operator flagged: a **mirror axis** (one
option per item) scores the *maximum* reduction — the exact question the constitution forbids would become
*preferred* — and the **unknown-on-axis** handling was undefined, which makes the sum itself ill-defined.

## Decision — `max-info-gain@v4`
1. **Score = expected residual pool size.** `reduction = S − (Σsᵢ² + u₀²)/S`, where **S = the node's EXACT
   pool size |E|** (a *node* property — identical for every candidate axis at that node), `sᵢ` = per-option
   EXACT count, and **u₀ = S − Σsᵢ** is the **explicit unknown-on-axis residual bucket**. Justification is
   literally the **expected size of the pool that remains** after the shopper answers (`Σsᵢ²/S = Σ(sᵢ/S)·sᵢ`),
   *not* a Gini index — maximizing the reduction shrinks the candidate pool as fast as possible, the actual
   goal. Because S is node-constant, ranking by max reduction **== ranking by MIN of the integer
   `Σsᵢ² + u₀²`** — no division, no float, no log (determinism + hash safety).
2. **Unknown = a separate residual bucket, defined in policy.** `unknown_axis_handling =
   "separate_residual_bucket"`. An ungrounded value is *never* `exact` (exact ⇒ SAT ⇒ grounded), so it leaves
   every `sᵢ` and lands in `u₀`; the buckets `{sᵢ} ∪ {u₀}` **partition** the node's exact pool, so
   **Σsᵢ + u₀ = S** is asserted at every node (Σsᵢ > S — multi-membership — throws, surfaced not miscomputed).
   The kernel's downstream *classification* of an unknown stays mode-dependent and unchanged (NEVER_RELAX
   rejects; RELAXABLE compromises into every branch) — that is the runtime partition, distinct from this
   design-time selection accounting.
3. **Guards (all counts-only).** `reduction > 0` strictly (kills a no-split single-value axis); the **mirror
   guard** — reject if the median option size is 1 **or** `options / Σsᵢ > mirror_option_density_max` (a
   per-item-identifier axis scores the max reduction, so it can only be gated by DENSITY, never by gain); and
   the existing `min_exact_option_ratio` mostly-compromise gate.
4. **Tie-break order (id is last, never first).** fewer options → smaller `max sᵢ` → higher axis **evidence
   degree** (`oracle.groundedCount` — grounding coverage, counts only) → canonical axis id (last resort, never
   removed — determinism). The alphabetical id is removed as the *first* criterion (it caused the collapse).

## Consequences
- **The collapse is fixed and generalizes.** Under v4 the generalize gate is GREEN: A branches only the
  dominant axis (depth 3→1), C never branches its single-value axis, and the mirror guard refuses "which
  type?" when only individuals remain. `tests/btree.axisrule-v4.test.mjs` asserts BOTH the documented bug (v3
  picks the useless axis) and the fix (v4 does not), plus the mirror/reduction/u₀/determinism properties.
- **oudfactory before/after (correction, not regression — gold frozen by hash, never re-signed).** Reach is
  identical; v4 refuses low-value/mirror deep questions, so the tree is shallower with zero compromise:

  | level | v3 | v4 |
  |------|----|----|
  | 1 | surface=41 · comp=0% · root=type | **identical** (41 · 0% · type) |
  | 2 | surface=55 · comp=0% · leaves=10 | surface=51 · comp=0% · leaves=8 |
  | 3 | surface=60 · comp=**7%** · leaves=15 · depth 3 | surface=51 · comp=**0%** · leaves=8 · **depth 2** |

  Full tree v4: `in_candidate_pool=80/80 (100%)` unchanged · `surface@cap=51/80 (64%)` (v3 was 60/80) ·
  `with_expansion=80/80` (ق20 grid, GAP-7) · `compromise_only_leaf_rate=0%` · all drops `family_buried`
  (cap/structure), `variant_unreachable=0`. The lower `surface@cap` is a **display-depth** effect of a
  shallower tree (bigger leaves truncated by cap=4), **not** a reachability loss — the grid still commits all
  80. This tradeoff (fewer, more honest questions vs more surfaced within the cap) is a product decision left
  visible to the operator, not silently accepted.
- **All seven stop conditions still hold under v4** (SC1 re-runs the v4 rule from transcript counts). Full
  suite green; gold pins unchanged (`gold-1.0.0`, sha OK).

## Files
`authoring/brain2/axisRule.js` (`chooseAxisByInfoGainV4`/`diagnoseAxesV4`) · `authoring/brain2/tree.js`
(`RULE_V4`, `buildFullTree` default) · `engine/kernel/authoringOracle/authoringOracle.js` (`groundedCount`) ·
`config/policy.json` (`axis_rule_id`, `mirror_option_density_max`, `unknown_axis_handling`) ·
`tests/btree.axisrule-v4.test.mjs` (new) · `tests/btree.generalize.test.mjs` + `tests/btree.fulltree.test.mjs`
(SC1 → v4). **Not touched:** the compiler/Certifier, render, ingestion, wiring; gold.
