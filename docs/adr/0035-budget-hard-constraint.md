# ADR-0035 — Budget is a HARD (ordinal) constraint, not a soft preference

Status: Accepted · 2026-07-24 · extends the hard-axis machinery of ADR-0034

## Context

The operator verified, live, that **39 of 108** decision rules (36%) recommended a product
**outside** the chosen price band — including a "**< 500**" path returning a **4087** piece
(8×). Root cause: same family as the format bug. Budget was still a **soft** axis
(mismatch `-0.5`), so a product with the right form + character + intensity won even when
its price was 4× the shopper's stated band. "I want under 500" must mean *under 500*.

A wrinkle the tiers exposed: this store has **no cheap perfume** and **no mid-tier raw** —
so some (form × price-band) cells are genuinely **empty**. Pure strict filtering there
would dead-end (trust gate forbids that) or force a cross-form pick (worse). Empty cells
are inherent to the catalog, not a tiering artefact (they persist at 2 *and* 3 tiers).

## Decision

1. **Budget is a HARD ORDINAL axis (`budgetAxis.js`).** Tiers are derived deterministically
   from the real cleaned prices (tertiles), each **labelled with its real range** so the
   text the shopper reads *is* the filter (top band open-ended, "أكثر من X"). `productBudget`
   assigns each product its tier from its price; no price → `null` (wildcard, never
   orphaned). The AI may not touch it — price is a fact (`looksLikeBudgetAxis` drops any
   AI/mined price axis).
2. **Ordinal semantics in `_assignCovering`.** A hard *ordinal* axis rewards the exact tier
   (`+2`) and penalises off-tier by step (`-100 × distance`). So an exact-tier product
   **always** beats any off-tier product and any soft advantage — budget is effectively
   hard **whenever the cell has products**. Only when a (form × tier) cell is genuinely
   **empty** does the least-penalised product win: the **nearest tier of the same form** —
   never across a strict hard axis (format), never wildly off. The backfill `simTo` follows
   the same rule.
3. **Both hard axes always partition.** `authorFromAxes` and `authorFunnel` inject
   `[format, budget]` into every candidate set; coverage is achieved **within** each
   (form × band) cell; soft axes (character/intensity) discriminate inside it. Combo budget
   400; if depth would exceed it, soft axes drop first — strictness never yields.

## Consequences

- **Zero budget leak for every populated cell** (locked by `tests/budget-hard.test.mjs`):
  the recommended product's real tier equals the chosen tier. The 8× disaster is gone —
  no recommendation is ever more than one tier from the chosen band, and never a different
  form. The only non-exact rules are the genuinely empty cells (e.g. "cheap perfume"),
  which return the nearest-price product **of the same form** — the honest best, disclosed.
- **Coverage stays ~100%**, now within the (form × band) partition. No gate weakened, no
  fabrication; price is a real catalog fact. Deterministic runtime; both authoring paths.
- Unit tests for the covering *mechanism* were isolated from injection (their synthetic
  products carry no price) — the hard-axis behaviour is proven by the format/budget suites.
  Preview only; live untouched.
