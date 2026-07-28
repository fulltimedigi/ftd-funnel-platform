# ADR-0048 — Step 4-b (first step): a one-level oracle-authored tree + round-3 contract corrections

- **Status:** Accepted (first step only — one-level tree proven; level-2 / full tree NOT started)
- **Date:** 2026-07-28
- **Related:** ADR-0046 (Kernel Authoring Oracle), `docs/standards/certified-pipeline-contract.md` (round-3 §).

## Context

4-a delivered the oracle (matching = kernel monopoly, brain = thin client). 4-b rebuilds the decision tree
by the oracle alone (derivation, not porting). A post-4-a review surfaced four contract corrections that
must land *before* any tree is authored, plus a first step scoped to a **single level** with a stop-and-show.

## Decision — four corrections (round-3), then a one-level tree

### C1 — lineage at edge AND tree level
- The edge MAC now also binds `child_evaluation_hash` + `context_ref` (`poolRegistry.mintEdge`): pool identity
  by membership is weaker than evaluation identity — same members under a different state/policy mean something
  different, so an edge authorizes a specific *child evaluation under a specific context*, not just a roster.
- **Tree-level verification** (`session.verifyTree`): every tree edge corresponds to a minted edge whose
  `parent_pool_ref` is the actual parent pool and whose `child_evaluation_hash` is the child's actual hash, **and
  the set of tree edges equals the set of ALL minted edges exactly** (bijection) — so valid edges cannot be
  assembled into an unauthorized tree, and no minted edge is silently dropped.

### C2 — hash completeness for axis contracts (resolved values)
- `canonicalConstraints` now folds the constraint's `resolved` predicate (numeric thresholds) into the hash. If
  constraint state is serialized by labels (`budget:"low"`), changing a contract threshold would otherwise change
  matching without changing the hash. Now the resolved threshold *is* a hashed input (option (b), the clean one);
  axis order is deliberately NOT added (it doesn't change classification).

### C3 — option completeness from the kernel, not the brain's claim
- `enumerateQualifiedOptions(units, constraints, answers, axisId)` (new kernel export) returns every distinct
  grounded value of the axis among candidates eligible at the current answers — the roster the transcript must
  cover exactly. `session.probe()` evaluates an option (transcript mark + REFINE monotonicity) **without** minting
  an edge, so an option can be *evaluated but not published* — every enumerated option is probed; only non-empty
  exact options are published (no dead-end leaf, no silent drop).

### C4 — split axis contract (isolation is structural, not disciplinary)
- `AuthoringOracle` (new facade) holds the RESOLVED contract (predicates/thresholds → kernel constraint, never
  exposed) and hands phase B only the PRESENTATIONAL contract: `axis_id`, opaque `option_ref`s, display labels.
  Phase B references options by ref and reads counts; it never holds a value or a threshold, so "build a matcher
  from projection data" is unrepresentable. `authoring/brain2/oneLevelTree.js` imports nothing from `engine/kernel`.

### The first step
`buildOneLevelTree(oracle, "type")` authors a one-level tree for the real oudfactory catalog through the full
chain. Declared axis-selection rule: "the given axis, and every qualified option the kernel enumerates at the
root"; publish every non-empty-exact option, probe (don't publish) the rest.

## Results (stop-and-show, `tests/btree.onelevel.test.mjs`)

- Verifier is **red-first** (proven: `verifyTree` rejects a forged tree — bijection mismatch + invalid MAC), then
  **green** on the oracle-authored tree.
- Six checks green: (1) every published option has a minted edge with non-empty exact + tree edges == minted edges
  (5 == 5); (2) option completeness vs the kernel enumeration + declared rule; (3) four-part REFINE monotonicity;
  (4) isolation (brain2 imports no predicate/catalog; projection carries no ids/vectors/evidence/digest/ranking);
  (5) a budget-contract threshold change moves the hash; (6) SKU reach.
- **Numbers:** one-level tree on `type` → 5 enumerated, 5 published · **SKU reach 80/80 (100%)** across 5 leaves ·
  calls=6, cacheHits=5 · full suite 98 green.

## Consequences

- The tree is now derived by the oracle with structural (not disciplinary) isolation and edge+tree-level
  authorization. The one-level result reaches every SKU, so no coverage regression at depth 1.
- **Not in this step:** level-2 / the full tree, the structural compiler + certifier, wiring, and the render/
  ingestion layers are untouched. Gold remains frozen by hash. The stop point is honored.
