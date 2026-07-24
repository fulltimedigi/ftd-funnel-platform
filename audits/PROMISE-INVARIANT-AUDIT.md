# Promise-Invariant Audit — proactive, store-agnostic

**Date:** 2026-07-24
**Question:** Does the funnel engine honor every choice it asks the shopper to make — on ANY
store, not just the one we happened to test?

## Method
`audits/promise-invariant.mjs` runs the REAL authoring pipeline (`authorFunnel`) on four
DIVERSE synthetic catalogs (perfume, laptops, supplements, coffee — different verticals,
price shapes, attributes). For every rule in each generated decision table it checks, per
axis, whether the recommended product actually carries the value the rule selected.

## Result — one root cause, on every vertical

| Store | Axis | Kind | Violations |
|-------|------|------|-----------|
| Perfume | `format` | **HARD (ADR-0034)** | **0 / 36 ✅** |
| Perfume | `scent` | soft | 6 / 36 🔴 |
| Laptops | `os` (usetype) | soft | 2 / 9 🔴 (chromeos → a Windows gaming laptop) |
| Supplements | `goal` | soft | 2 / 12 🔴 (energy → Vitamin D) |
| Coffee | `roast` | soft | 4 / 9 🔴 (medium → light roast) |
| Coffee | `usetype` | soft | 2 / 9 🔴 |

**Total: 16 silent promise-violations — all on SOFT axes, ZERO on the one HARD axis.**

## Conclusion
This is not many bugs; it is ONE design gap (a shopper-chosen axis treated as a soft score
the matcher may override) surfacing on every vertical. The hard-axis mechanism built for
`format` (ADR-0034) is proven correct — **0 violations where applied, in the same store, same
run** — it simply is not yet applied to the other axes.

## Fix — "The Promise Principle" (ADR-0036, planned)
1. Every categorical/range axis becomes a RANKED hard constraint, not a soft score.
   - Tier 1 (never relaxed): `format`, `budget`.
   - Tier 2 (relaxed lowest-priority-first ONLY when the catalog can't satisfy the full set,
     and DISCLOSED to the shopper: "أقرب اختيار — يختلف في X"): all other categorical axes.
2. This exact audit becomes a committed build test (`tests/invariant.universal.test.mjs`) that
   FAILS the build if any Tier-1 axis is ever violated, or a Tier-2 axis is violated without
   disclosure — on any of a battery of synthetic verticals.

Never silently override a shopper's stated choice. If we ask it, we keep it — or we say we
couldn't.
