# ADR-0068 — budget_ceiling axis role + leaf-filter architecture (brain2 completion, part 1 of N)

- **Status:** Accepted. Root capability BUILT + verified in isolation (`tests/kernel.ceiling.test.mjs`), DORMANT
  on the shared oud fixture (activation is the next increment — see "Remaining"). Freeze narrowed. Suite green.
  Pull/SSRF untouched. Gold frozen; nothing softened.
- **Date:** 2026-07-29
- **Related:** ADR-0067 (the blocking finding), ADR-0063 (variant-level ceiling in the certifier), constitution
  ق2 / ق13, `authoring/brain/decisionTree.js` (brain's variant-level budget), consultation round-12 (step 3).

## Context
ADR-0067 measured brain2 on the gold: exact 2/11, silent 9, unserved 25 — two structural root causes: (1) budget
matched **band-exact** and **branched** like a partition axis; (2) no ق2 mandatory "any" reachability branches.

## Root-cause decision (grounded in the constitution + brain + the certifier)
1. **budget_ceiling is `≤ ceiling`, evaluated in the KERNEL (ق13).** The answer is a CEILING, not an equality
   target: a unit AT/BELOW the answered band satisfies (cheaper is fine); only over-ceiling overshoots. This
   **unifies ask-time with certify-time** — the certifier already applies the variant ceiling (ADR-0063) — so the
   two-sources-of-truth dissolves.
2. **A ceiling axis is a LEAF-LEVEL filter, NOT an info-gain branch.** Implementing (1) surfaced a decisive fact:
   a ceiling does **not partition** the pool (a family qualifies for *every* band ≤ its cheapest variant → the
   per-option exact counts overlap, `Σsᵢ > S`, breaking the info-gain partition invariant). Confirmed against the
   reference: **brain does not branch on budget** — "a family qualifies for a budget band by this variant, and
   the leaf shows THIS variant" (`decisionTree.js`). So budget is excluded from branch selection and applied at
   the leaf (which the certifier already does). This is **not** a change to `rankAxesV10` (the ranking of
   *branchable* axes) — it is which axes are *branchable*, an acceptance/reachability concern (unfrozen).

## Built + verified in isolation (`tests/kernel.ceiling.test.mjs`, in `npm test`)
- `constraintKernel.status` — a role-gated ceiling: `role: "budget_ceiling"` ⇒ `rv ≤ ra → SAT`, else overshoot.
  **Plain ordinal is unchanged** (still symmetric equality) — the ceiling is role-gated, not a global change.
- `AuthoringOracle.ceilingAxisIds()` / `branchableAxisIds()` — a budget_ceiling axis is excluded from the
  branchable set (a leaf filter), while remaining available for leaf-time matching.
- The oracle now propagates `role` / `direction` from the resolved contract into the kernel constraint.

## Measured evidence (capability activated on the oud fixture during development; then reverted to keep green)
With budget matched as a ceiling AND excluded from branching, brain2's unserved dropped **25 → 15** (the budget
half of the gap closed: budget-constrained intents now serve via the leaf filter). The remaining **15** are the
**origin="any" / unoffered-origin** intents — they need the ق2 mandatory "any" reachability branches (not yet
built). Exact did not yet rise (blocked by the same origin routing). Shown, not fixed.

## Freeze narrowed (per operator instruction #3)
`tests/btree.axis-selector-freeze.test.mjs` asserted a tree-SHAPE number (`surface@cap ≥ 61`). The freeze's
contract is `rankAxesV10` **behavior** (checks 1–3, synthetic inputs) — a tree-shape number is not the ranking's
contract, so it was testing the wrong thing. surface@cap is now a **reported shape diagnostic**, not a freeze
gate. This is a **test correction, not a freeze breach** (the ranking function is unchanged).

## Why activation is a separate increment (honest scope)
Activating budget_ceiling on the SHARED oud fixture ripples into **4 legacy tests** (`btree.fulltree` SC7 and
`btree.axisrule` v4/v5/v7) that call the OLD `diagnoseAxes*` **directly** on the budget axis and assert its
partition invariant — which a ceiling legitimately breaks. Those are legacy re-measures to update (exclude the
ceiling axis from those direct diagnose calls). **Plus** the ق2 "any" branches require an oracle change (an
"unconstrained" child that keeps the parent pool with a lineage receipt). Bundling all of that with the root
capability in one commit would risk an unverifiable half-state. So: capability committed + proven now; activation
+ any-branches + the four re-measures + reaching 11/11 + the generalization round are the **next red-first
increment**, target = **brain2 matches brain's 11/11·0·0 on the gold**.

## Consequences / remaining (the ordered next increment)
1. Add ق2 mandatory "any" reachability branches for soft axes (oracle `publishUnconstrained` + tree wiring;
   assert: `u₀ > 0` or out-of-published candidates ⇒ an "any" option MUST exist, else build fails).
2. Activate `role: "budget_ceiling"` on the oud fixture (+ any production catalog→inputs adapter later).
3. Update the 4 legacy tests to exclude the ceiling axis from their direct `diagnoseAxes*` calls; update SC7's
   path assertion for the new tree.
4. Red-first: brain2.remeasure fails at the current numbers, greens at exact 11/11 · silent 0 · hard 0 · unserved
   = the structural set in the gold. No editing gold or any assertion.
5. Re-run the generalization round (5 catalogs) + the seven stop conditions; show any regression.
Not touched: `rankAxesV10`, gold, kernel matching semantics for non-ceiling axes, pull/SSRF.
