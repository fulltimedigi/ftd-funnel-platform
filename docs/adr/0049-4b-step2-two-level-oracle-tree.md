# ADR-0049 — Step 4-b (second step): a two-level oracle-authored tree (type → budget)

- **Status:** Accepted (second step only — two-level tree proven; level-3 / full tree NOT started)
- **Date:** 2026-07-28
- **Related:** ADR-0046 (oracle), ADR-0048 (4-b step 1), `docs/standards/certified-pipeline-contract.md` (round-3).

## Context
Step 4-b level 1 built a one-level oracle-authored tree. Level 2 (type → budget) adds a second axis, and a
post-step review required five corrections *before* building, then five stop conditions.

## Decision — five pre-build corrections
1. **Node identity in the transcript:** every entry carries `parent_pool_ref + context_ref + axis_id +
   option_ref + exact_count`; option-completeness is measured PER NODE, not globally.
2. **Two-ledger link:** every minted edge ⇔ a probe entry with `exact≠0`; `probe()` still mints no edge
   (edges = authorization; the transcript = no-prediction — two different ledgers, cross-checked).
3. **`context_ref` folds `axis_contract_digest`** — two contexts with the same three versions but different
   axis contracts no longer collide on one ref.
4. **`transition_kind` enforced, not assumed:** the four-part monotonicity check runs on `REFINE` only; a new
   `RELAX` transition is exempt (a growing move is accepted as RELAX, rejected as REFINE — both tested).
5. **Two reach metrics, always reported:** `in_candidate_pool` (in a leaf's candidate set) vs
   `surface_reachable` (shown as primary/alternate within the display cap).

## The build + stop conditions (all green, `tests/btree.twolevel.test.mjs`)
`authoring/brain2/twoLevelTree.js` (phase B, imports no predicate/catalog) authors type→budget via the oracle
alone, choosing the axis at each node by the DECLARED counts-only rule (`axisRule.js`). Verifier red-first
(a wrong axis fails SC1; a forged node fails the bijection 14≠13), then green:
- **SC1** the counts-only rule re-runs to the same axis the brain chose at every internal node.
- **SC2** `answers(child) = answers(parent) + exactly one option`.
- **SC3** node identity present + the two-ledger link holds.
- **SC4** four-part REFINE monotonicity across both levels; RELAX exempt.
- **SC5** both reach metrics reported + dropped SKUs named.
- Carried: tree edges == minted edges (bijection over both levels) · per-node option completeness vs the
  kernel enumeration · brain2 isolation · projection purity · a threshold change moves the hash.

## Results (oudfactory, type → budget)
14 nodes · 6 internal · 8 leaves · calls=14, cacheHits=13. **`in_candidate_pool` 80/80 (100%) ·
`surface_reachable` 55/80 (69%)** (cap 4/leaf, 8 leaves); 25 SKUs fall outside the surface (named in the test
output). **Governing record:** 80/80 is true *by construction*, not an achievement — real reach is
`surface_reachable` (69%); the surface number is the truth to optimize. Full suite 99 green.

## Consequences
The second axis exposes the real reach gap (a wide leaf surfaces only its cap; the rest are candidates but
not shown) — exactly why the two metrics are separated. Level-3 / the full tree, the structural compiler +
certifier, wiring, and render/ingestion are untouched. Gold frozen by hash.
