# ADR-0051 — Step 4-b (final step): the full oracle-authored tree (gated info-gain-on-exact)

- **Status:** Accepted (full tree proven; certification + wiring NOT started)
- **Date:** 2026-07-28
- **Related:** ADR-0046/0048/0049/0050, `docs/standards/certified-pipeline-contract.md` (round-3 §), GAP-7.

## Decision — five rulings, then the full tree
1. **Cap governs display, not reachability.** Adding a question to raise `surface_reachable` is asking a
   question to please a counter (ق11) — forbidden. An overstuffed leaf becomes a comparison grid (ق20), never
   cut. Two numbers are measured: `surface_reachable@cap` (truth) and `surface_reachable_with_expansion`
   (grid); their difference is a **display commitment recorded in KNOWN-GAPS (GAP-7)** — not claimed before the
   grid is built.
2. **A mostly-compromise axis does not branch.** A pure counts gate `min_exact_option_ratio` (policy): an axis
   whose fraction of options with `exact≠0` is below it is descriptive (display/explanation), not a question.
3. **Info-gain on `exact`, not `eligible`** (`max-info-gain@v3`); the ruling-2 gate is a strict filter before
   ranking (so a soft axis can't be chosen by "reducing" while zeroing exact).
4. **Explosion limits from policy, not cache.** Semantic stops (`exact ≤ leaf_primary_cap`; no axis passes the
   gate) end branching for a reason (ق12); hard limits (`max_tree_depth`/`max_nodes`/
   `max_oracle_calls_per_funnel`) **fail the build explicitly on exceed — never a silent truncation.**
5. **Seventh stop condition — path-order equivalence:** two root→leaf paths whose constraint states are equal
   as sets ⇒ identical `evaluation_hash` and identical leaf result (order must not leak into meaning — the
   axis-interaction effect invisible before three levels); plus a **degenerate-branch** rejection (a question
   whose every option yields the same result).

## Build + verification (all green, `tests/btree.fulltree.test.mjs`, red-first)
`authoring/brain2/tree.js::buildFullTree` (phase B, counts only — no roster, no predicate/catalog) authors the
whole tree with `RULE_V3`. Verifier red-first (forged node fails bijection 26≠25), then green: SC1 (v3 rule
re-run from transcript counts) · SC2 · SC3 (two-ledger link, scoped + compromise-aware) · SC4 (monotonicity +
RELAX exempt) · SC5 (two surface numbers + cause split + compromise rate + v3 before/after) · SC6 (path
integrity) · SC7 (path-order equivalence + no degenerate branch) · carried (bijection, per-node completeness,
isolation, projection purity, threshold→hash) · Ruling-4 hard-limit hard-fail.

## Results (oudfactory)
depth **3** · **26** nodes · 11 internal · **15** leaves · calls=49, cacheHits=50. Branching axes:
type/origin/budget (origin branches ONLY at nodes where its per-node exact-ratio passes the gate).
`in_candidate_pool` **80/80 (100%)** · `surface_reachable@cap` **60/80 (75%)** · `with_expansion` **80/80
(100%)** (GAP-7, 20-SKU display commitment). Dropped@cap 20 — **all `family_buried`, 0 `variant_unreachable`**.
`compromise_only_leaf_rate` **1/15 (7%)**. **v3 before/after:** level 2 compromise 38%→**0%**; level 3
compromise 56%→**7%** at ~identical surface — the new rule dissolves the compromise explosion the operator
flagged, at negligible surface cost.

## Consequences
The full tree is bounded by SEMANTIC stops (not the cache), branches only on axes that discriminate exactly,
and its real reach is reported honestly with the display commitment split out. Certification (compiler +
Certifier), wiring, and the render/ingestion layers remain untouched. Gold frozen by hash.
