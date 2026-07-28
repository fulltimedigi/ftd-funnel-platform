# ADR-0059 — The structural compiler (phase 1): tree → CertificationInput, wired from birth

- **Status:** Accepted (phase 1 built + proven, red-first). STOPPED at stop-point 2 (compiler vs done-definition).
  The Certifier (full consumption + real mint rate) is phase 2, not built.
- **Date:** 2026-07-28
- **Related:** ADR-0058 (freeze + leak boundary + done-definition), `authoring/compiler/structuralCompiler.js`,
  `tests/compiler.structural.test.mjs`, `docs/standards/certified-pipeline-contract.md` (round-10 §),
  consultation round-10.

## What was built
`authoring/compiler/structuralCompiler.js` — a pure SHAPE transform from a real oracle-authored tree to a
`CertificationInput` that encodes the tree AS A TREE:
- `compileTree(oracle, tree, opts)` → `{ version:"cinput-1", context, d_star, expected_reachable_paths, root }`,
  where each node is `{ node_id, node_kind, answers, (question: axis+children) | (leaf: receipt) }`.
- `node_kind` is derived PURELY from structure: **question** (branches), **terminal** (leaf, resolved pool ≤
  leaf_primary_cap — a single decided pick), **display** (leaf with more — a ق20 grid/selector). No reason used.
- `d_star` is computed HERE from tree depth (ق20). Per-leaf **receipt** = the kernel's `{state_outcome, counts,
  opaque pool refs}` — carried, never interpreted.
- `canonicalBytes` (sorted keys) → deterministic bytes. `verifyShapeAndCompleteness` = the THIN CONSUMER.

## Done-definition scorecard (9 clauses; clause 6 modified per the operator)
| # | clause | status |
|---|--------|--------|
| 1 | a REAL tree → CertificationInput | ✅ oud tree → cinput (16 nodes, d*=2) |
| 2 | ZERO matching logic | ✅ imports no kernel/predicate/rule; no `classifyUnit`/`select`; test-asserted |
| 3 | no ref interpreted | ✅ pool refs + node_id ride opaquely; no `membersOf`; test-asserted |
| 4 | all paths + terminal states preserved | ✅ every leaf → a terminal/display node; walk == leaves |
| 5 | `expected_reachable_paths > 0` | ✅ = 11 (== leaf count) |
| 6 | **thin consumer verifies shape+completeness** (was "Certifier consumes"; Certifier deferred to phase 2) | ✅ `verifyShapeAndCompleteness` wired + green from birth |
| 7 | coverage known | ✅ `expected_reachable_paths` + per-leaf receipts; surface debt is GAP-7 (publish blocker) |
| 8 | a deleted path reddens the tests | ✅ dropping a child → consumer NOT ok |
| 9 | re-run ⇒ identical bytes | ✅ recompile == byte-identical |

## The decisive leak-boundary test — PASSED
Change the display-mode REASON (and every mirror signal / rejection reason) with the tree STRUCTURE fixed ⇒
`canonicalBytes` is **byte-identical**. The compiler reads NONE of `tree.guardRejections` /
`tree.mirrorSignals` / `tree.displayModeNodes` — the "why" stays in the brain transcript. A forbidden 'why'
key planted into a cinput is rejected by the consumer (`FORBIDDEN_KEYS`).

## Findings during the build (review discipline, from the first commit)
| finding | classification | law | test-that-must-red | blocks stop-point? |
|--------|----------------|-----|--------------------|--------------------|
| the leak-boundary import-scan regex matched the compiler's own **docstring** (the words `classifyUnit`/`select` in prose), a false positive | **integrity** (test correctness, not a funnel defect) | — | the false-positive check | no — fixed immediately (reworded the docstring; no code path involved) |

No safety/quality funnel finding arose. Round 1 of review; the two-round cap and "no new requirements in round 3 except proven safety/integrity" apply from here.

## Consequences
- The compiler is **wired from birth** (a consumer verifies its output) — it cannot become a "built and
  unwired" artifact. Full consumption (the Certifier) + the real mint rate are phase 2 (stop-point 3).
- Byte-deterministic, structure-only, zero matching, no ref interpretation, no "why". Full suite green; gold
  frozen.

## Files
`authoring/compiler/structuralCompiler.js` (new) · `tests/compiler.structural.test.mjs` (new, red-first) ·
`docs/standards/certified-pipeline-contract.md` (round-10 §). **Not touched:** the Certifier body, render,
ingestion, wiring, delivery; the frozen axis-selector v10; gold.
