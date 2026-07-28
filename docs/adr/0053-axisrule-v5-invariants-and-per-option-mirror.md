# ADR-0053 — Axis-selection rule v5: hard invariants + per-option mirror guard

- **Status:** Accepted (rule hardened + proven; certification + wiring still NOT started)
- **Date:** 2026-07-28
- **Related:** ADR-0052 (`max-info-gain@v4`), `tests/btree.axisrule-v5.test.mjs`, `config/policy.json`,
  consultation round-5.

## Context
Round-5 review accepted v4's score (`reduction = S − (Σsᵢ²+u₀²)/S`, expected residual pool size) and
sharpened it: the score is only meaningful under two invariants v4 left implicit, and v4's mirror guard was
both **evadable** and **over-eager**.
- **Evadable:** a minority of singletons planted among legitimate buckets (e.g. 6 options of 3 + 5 of 1:
  median 3, density 0.478) passes v4's median/density guard — yet v4 *prefers* it (lowest Σsᵢ²), so the exact
  mirror question the constitution forbids becomes the winner.
- **Over-eager:** on a tiny pool (S=2, two distinct products) v4's `median==1` guard rejects an **honest final
  binary** — a legitimate question.
- **Undefined unknown reachability:** `u₀²` silently assumes the u₀ units stay reachable; for a NEVER_RELAX
  axis with u₀>0 they are rejected by every branch and vanish (ق2 dead-end), which the score cannot see.

## Decision — `max-info-gain@v5` (score unchanged)
1. **Partition invariant (per axis, per node):** `Σsᵢ + u₀ = S`. Since `u₀ := S − Σsᵢ`, the meaningful check
   is `Σsᵢ ≤ S`; a violation (multi-membership) makes the cross-axis denominator undefined and **throws**
   (`diagnoseAxesV5`).
2. **u₀-reachability invariant (server-side `oracle.verifyReachability`):** for every internal node the union
   of its published children's ELIGIBLE pools must cover the node's EXACT pool — no exact candidate dropped by
   branching. RELAXABLE unknowns compromise into every child (covered); a NEVER_RELAX axis with u₀>0 drops
   them (**build fails**). Enforced here, from the roster, because the counts-only brain cannot see relax mode.
3. **Per-option mirror guard:** reject an axis whose **singleton share** (options of size 1 as a fraction of
   Σsᵢ) exceeds `mirror_singleton_share_max` (0.2) — a per-option test that catches the planted-minority case
   median/density miss. **Exempt when `S ≤ leaf_primary_cap + 1`** (the final binary that narrows to the cap).
   The v4 median/density criteria are retired.
4. **Keep depth; never tune for surface.** The recorded surface movement (below) is a byproduct of guard
   correctness — **no question is added and no ties are cut** to move the number (ق11/ق20); depth is unchanged.

### Surfaced deviation (needs a one-word confirm)
The operator's literal exemption `S ≤ leaf_primary_cap` is **redundant** (with `leaf_primary_cap=1` such a node
is already a leaf via semantic-stop-1) and would **not** exempt the operator's own S=2 accept-case. Implemented
as **`S ≤ leaf_primary_cap + 1`** and flagged in `policy._mirror_exemption_note` for confirmation.

## Consequences
- **Red-first proof** (`tests/btree.axisrule-v5.test.mjs`): v4 *chooses* the mirror-ish axis (documented
  miss); v5 *rejects* it by name and picks the grouping axis. The honest S=2 binary is exempt (asked); an S=3
  all-singleton axis is not (a grid). `verifyReachability` FAILS on a synthetic NEVER_RELAX-with-u₀ catalog
  (2 units dropped) and PASSES when the axis is RELAXABLE. Partition invariant throws on Σsᵢ>S.
- **oudfactory before/after (correction, gold frozen by hash, never re-signed):**

  | level | v3 | v4 | v5 |
  |------|----|----|----|
  | 1 | surf 41 · comp 0% | 41 · 0% | **41 · 0%** |
  | 2 | 55 · 0% · lv10 | 51 · 0% · lv8 | **61 · 0% · lv9** |
  | 3 | 60 · **7%** · lv15 | 51 · 0% · lv8 | **61 · 0% · lv9** |

  Full tree v5: `in_candidate_pool=80/80` unchanged · `surface@cap=61/80 (76%)` (v4 had wrongly dropped it to
  51 by over-rejecting honest small-pool binaries) · `with_expansion=80/80` (ق20 grid, GAP-7) ·
  `compromise_only_leaf_rate=0%` · `depth=2` (unchanged) · all drops `family_buried`, `variant_unreachable=0`
  · **u₀-reachability OK** (type fully grounded; origin RELAXABLE). The surface recovery 51→61 is the
  exemption fixing v4's over-rejection — **not** counter-tuning (depth unchanged, no added question).
- **All EIGHT stop conditions hold under v5** (SC1 re-runs the v5 rule; new SC8 = reachability). Generalize
  gate green on all three catalogs (B/C now correctly ask honest small-pool binaries v4 was refusing). Full
  suite green; gold pins unchanged (`gold-1.0.0`, sha OK).
- **GAP-7 priority rises:** the `with_expansion − @cap` display commitment (19 SKUs) matters more as the tree
  is decisive; it remains a KNOWN-GAPS commitment, not claimed as delivered reach.

## Files
`authoring/brain2/axisRule.js` (`diagnoseAxesV5`/`chooseAxisByInfoGainV5`) · `authoring/brain2/tree.js`
(`RULE_V5`, default; `buildTree` ruleCfg passthrough) · `engine/kernel/authoringOracle/authoringOracle.js`
(`verifyReachability`) · `config/policy.json` (`axis_rule_id`, `mirror_singleton_share_max`, invariant notes) ·
`tests/btree.axisrule-v5.test.mjs` (new) · `tests/btree.{generalize,fulltree}.test.mjs` (SC1 → v5, + SC8
reachability). **Not touched:** compiler/Certifier, render, ingestion, wiring; gold.
