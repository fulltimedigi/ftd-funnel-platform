# ADR-0058 — Freeze the axis-selector (v10): separate SAFETY gates from the QUALITY ranking

- **Status:** Accepted. Ranking FROZEN (`axis_selector_version=v10`). Compiler NOT built (stopped at its
  done-definition per the operator).
- **Date:** 2026-07-28
- **Related:** ADR-0052..0057 (v4→v9), `tests/btree.control-random.test.mjs`,
  `tests/btree.axis-selector-freeze.test.mjs`, `authoring/brain2/axisRule.js`, `docs/KNOWN-GAPS.md` (GAP-7),
  `docs/standards/certified-pipeline-contract.md` (round-10 §), consultation round-10.

## Context — the control experiment, corrected
The classification "the axis-ranking rule is quality, not safety" was PROVEN, not asserted, by a control
experiment: rebuild the tree with a deterministic-random axis choice among the ACCEPTED axes only (gates on,
ranking off), across oud + 5 synthetic catalogs (incl. two malicious + one worst-case) × 7 seeds. A first
version measured `in_candidate_pool` (100% by construction — tests nothing) and wrongly concluded; the operator
caught it. Corrected to measure `surface_reachable@cap` — the ONE order-dependent invariant.

Result: every PER-NODE safety invariant holds under random selection (monotonicity, no empty branch, no
unsupported option, reach ledger, bijection); `in_candidate_pool`/`with_expansion` = 100% every order.
`surface_reachable@cap` DOES vary with order (oud 58–62/80; a worst-case fixture 10–18/20) — but it is **< 100%
in EVERY order**, so the ق2 shortfall (18–22 SKUs not surfaced today) exists **regardless of the ranking**; its
cause is the missing ق20 grid (GAP-7). Decisively, on the worst-case the FROZEN ranking gives the **lowest**
surface (10/20) — proof the ranking does not protect surface.

## Decision
1. **Freeze `axis_selector_version = v10` UNCONDITIONALLY.** The `surface_reachable@cap` variance is DISPLAY
   debt (GAP-7), not a commitment the ranking carries. Tying reopening to that number would pressure tuning the
   ranking to compensate for a missing display layer — the counter-tuning anti-pattern fought since v6.
2. **Separate, in code, SAFETY from QUALITY** (`authoring/brain2/axisRule.js`):
   - `acceptanceGates(...)` — SAFETY (partition invariant · reduction>0 · options-cap → display mode ·
     all-singleton → display mode · min_exact_option_ratio; plus the phase-A `authoringGates` semantic-type +
     evidence-basis). **NOT frozen** — may be strengthened anytime.
   - `rankAxesV10(...)` — QUALITY. Orders ONLY accepted axes; carries no gate logic. **FROZEN**
     (`AXIS_SELECTOR_VERSION="v10"`). Tie-break: penalized ↑ → k ↑ → maxSize ↑ → evidence ↓ → id ↑.
   - `RULE_V10` = gates ∘ frozen ranking; behaviorally identical to v9 (a separation + freeze, not a rule
     change). `buildFullTree` default → `RULE_V10`.
3. **GAP-7 is a PUBLISH blocker** (like the SKU-witness): a funnel promising reach its display can't deliver is
   not published while GAP-7 is open. GAP-7 blocks PUBLISH — never measurement, never the freeze.
4. **`surface_reachable@cap` is a REGRESSION baseline, never a reopen threshold** — the measured value at freeze
   (oud = 61/80), pinned with a fixture fingerprint (`tests/btree.axis-selector-freeze.test.mjs`). A drop is a
   surface regression to investigate; it does NOT auto-reopen or tune the axis selector.
5. **Four reopen conditions, each needing an ARTIFACT** (no artifact, no reopen): a broken promise with a RED
   test · a fixed benchmark failing a recorded baseline · a REAL catalog committed as a fixture that a merchant
   rejects · a scheduled review at the first published merchant. A hypothetical edge case → a named backlog.
6. **Worst-case fixture documented once, then closed** (not an improvement loop): a conditional-applicability
   axis + branch sizes at cap+1 + deliberate ties — surface swings 10–18/20; documented as a known limit.

## The compiler (written now, built later)
The compiler's leak boundary and done-definition are recorded in `certified-pipeline-contract.md` (round-10 §):
`CertificationInput` carries the tree STRUCTURE only (`node_kind`, children, accumulated answers, per-leaf
kernel receipts) — never the display reason / axis grade / mirror share / rejection log / any v10 trace (the
compiler needs WHAT the tree is, not WHY its axes were chosen; the byte-identical test: change the reason with
the structure fixed ⇒ identical output). Done-definition (9 clauses) and the review-classification discipline
are recorded there too. **Per the operator, work stops at the done-definition — the compiler body is not built.**

## Consequences
- `tests/btree.axis-selector-freeze.test.mjs`: version pinned, tie-break pinned, gates proven separate from the
  ranking, surface@cap baseline held (61/80). `tests/btree.control-random.test.mjs`: per-node safety under
  random selection across 7 catalogs × 7 seeds; the ruling recorded in-test. Full suite green; gold unchanged.
- Behavior is unchanged (v10 ≡ v9); this ADR fixes a lifecycle boundary, not a funnel.

## Files
`authoring/brain2/axisRule.js` (`acceptanceGates`, `rankAxesV10`, `diagnoseAxesV10`, `AXIS_SELECTOR_VERSION`) ·
`authoring/brain2/tree.js` (`RULE_V10`, default) · `docs/KNOWN-GAPS.md` (GAP-7 → publish blocker) ·
`docs/standards/certified-pipeline-contract.md` (round-10 §) · `tests/btree.axis-selector-freeze.test.mjs`
(new) · `tests/btree.control-random.test.mjs` (worst-case + ruling). **Not touched:** compiler body,
Certifier, render, ingestion, wiring; gold.
