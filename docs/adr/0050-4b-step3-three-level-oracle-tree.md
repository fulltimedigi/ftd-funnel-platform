# ADR-0050 — Step 4-b (third step): a three-level oracle-authored tree (type→budget→origin)

- **Status:** Accepted (third step only — three-level tree proven; full tree NOT started)
- **Date:** 2026-07-28
- **Related:** ADR-0046/0048/0049, `docs/standards/certified-pipeline-contract.md` (round-3 §).

## Decision — five pre-build corrections, then a three-level tree
1. **Reach split by cause (automatic):** every dropped SKU is classified — family reachable but SKU not ⇒
   `variant_unreachable` (GAP-6/offer); family itself unreachable ⇒ `family_buried` (leaf-cap/structure). No
   classification without the split.
2. **New axis rule `max-info-gain@v2`** (replaces "most-options", which prefers wide over discriminating):
   pick the axis with the greatest expected candidate-pool reduction `N − Σsᵢ²/S` on per-option ELIGIBLE
   sizes (counts only), deterministic tie-break by id. Versioned; the re-run check applies to it; impact
   measured before/after.
3. **Leaf caps from policy, not a test literal:** `config/policy.json → surface.{leaf_primary_cap,
   leaf_total_cap}`, `surface_reachable` computed from them and stamped with `policy_version`.
4. **Compromise-leaf publish rule:** `exact≠0` → publish; `exact=0 ∧ compromise≠0` → publish as a COMPROMISE
   leaf (deviation confined to the named relaxable axis; hard constraints already excluded from compromise);
   `exact=0 ∧ compromise=0` → NEVER publish (the dead-end). New metric `compromise_only_leaf_rate`.
5. **Sixth stop condition — path integrity:** walked leaves == recorded leaves (no orphan/duplicate); every
   root→leaf path terminates; no unannounced axis repeat on a path; applicability scope respected.

## Build + verification (all green, `tests/btree.threelevel.test.mjs`)
`authoring/brain2/tree.js` (phase B, imports no predicate/catalog) authors type→budget→origin via the oracle
alone with `RULE_V2`. Verifier red-first (forged node fails bijection 42≠41; a wrong axis fails SC1), then
green: SC1 (rule re-run from transcript counts) · SC2 (constraint accumulation) · SC3 (node identity +
two-ledger link, scoped to the chosen axis, compromise-aware) · SC4 (four-part REFINE monotonicity ×3 levels;
RELAX exempt) · SC5 (reach split + compromise rate + rule before/after) · SC6 (path integrity) · carried
(bijection, per-node option completeness, isolation, projection purity, threshold→hash).

## Results (oudfactory, type → budget → origin)
42 nodes · 15 internal · 27 leaves · calls=66, cacheHits=82. `in_candidate_pool` **80/80 (100%)** ·
`surface_reachable` **61/80 (76%)** (policy cap 4/leaf). Dropped 19 = `variant_unreachable` **0** +
`family_buried` **19** — i.e. every drop is structural (buried under the leaf cap), NOT a variant/offer issue
(this corrects the earlier "variant picker" hypothesis at family granularity). `compromise_only_leaf_rate`
**15/27 (56%)** — from the soft `origin` axis. **Rule-change impact (level 2):** v1 (most-options) picks
`origin` at the root (widest but non-discriminative — a useless first question); v2 (info-gain) picks
`budget`. Concrete confirmation that "most-options" would have broken level 3.

## Consequences
The real reach (`surface_reachable` 76%) rises with depth (more, smaller leaves) but the 24% gap is
structural (leaf cap), quantified and named. The new rule provably avoids the wide-non-discriminative trap.
Full tree, compiler+certifier, wiring, render/ingestion untouched. Gold frozen by hash.
