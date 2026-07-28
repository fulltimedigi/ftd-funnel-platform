# ADR-0063 — The size picker (GAP-6), variant-level band ceiling, and the node_kind bound fix

- **Status:** Accepted (built + proven, red-first). Publish status: **UNBLOCKED** on oud (SKU-level I3 = 80/80).
  Live render / delivery / webhook / pull NOT started.
- **Date:** 2026-07-28
- **Supersedes:** the "publish blocked" outcome of ADR-0062 (the gap it named is now built, not re-defined).
  **Related:** ADR-0058 (frozen axis selector v10), ADR-0059/0060, `engine/kernel/certifier.js`,
  `authoring/compiler/structuralCompiler.js`, `tests/certifier.gap7.test.mjs`, `docs/KNOWN-GAPS.md` (GAP-6/GAP-7),
  consultation round-12.

## Context — build the missing capability, don't re-define the metric
ADR-0062 measured the honest SKU-level I3 = 50/80: a family card pinned ONE variant, so a multi-variant
family's extra sizes stranded (`variant_unreachable`). The operator's ruling (round-12): **gaming the number**
is changing I3's *definition*; **building the deferred capability (GAP-6, the variant/size picker) is the real
fix.** Plus two corrections that land first.

## Decision
### 1. Band semantics — boundaries at the family level, matching at the variant level (with a ceiling)
The kernel's `ordinal` predicate is symmetric band-equality (band-exact); its `price` predicate is a directional
ceiling. Re-typing the budget axis in the shared oud fixture is **forbidden** — that fixture is pinned by the
**FROZEN axis-selector v10** (ADR-0058) and by 16 test files. So the ceiling is enforced where the SKU witness
lives — **the Certifier** — exactly matching the operator's rule: *band boundaries derived at the family level
(the design fixture), matching at the variant level.* A family qualifies for every path where it has a
**purchasable variant ≤ that path's ceiling**. **Guard (assert):** no purchasable variant is *band-locked-out*
of every path where it would be in budget (`not_arrived_by_reason.band_locked_out === 0`). On oud: **0**
locked-out — the pre-picker 50/80 gap is entirely the **folded size dimension**, not band-exact.

### 2. node_kind — the round-11 `exact ≥ 1` was an over-correction
`terminal ⟺ 1 ≤ exact ≤ leaf_primary_cap` (a single decisive pick); `exact > cap ⇒ display` (a real grid of
equally-exact picks — an 11-exact leaf is a grid, not a terminal); `exact = 0 ⇒ display` (COMPROMISE_ONLY). Still
NOT `resolved ≤ cap`. The oversized-grid declaration (ق20) stays orthogonal. On oud: **terminal=3, display=8**.

### 3. THE SIZE PICKER (GAP-6) — `engine/kernel/certifier.js` → `resolveLeafGrid`
- **One card per surfaced family + an in-card size picker** — never a card per size (ق4: size is a folded
  dimension; a card-per-size breaks the fold and inflates the grid).
- **Every in-budget purchasable variant is a SELECTABLE option**, each with its **own certificate**:
  `selection_result_id · buy_url · price · availability · path_certified`.
- **The default pre-selected variant comes from the KERNEL** (`select` over the family's in-budget variants),
  with a recorded `tie_break_reason`; price is only the kernel's stable tie-break key — **never a display-layer
  selection rule**. Guards: `defaults_from_kernel` and `default_outside_options === 0`.
- **Validity per size** (`validateCta`): resolves to a specific SKU, present in the shipped snapshot, ≤ the
  path's ceiling. An **over-ceiling** size is shown **labeled, no active CTA** (not purchasable on this path); an
  **unavailable** size is shown **labeled, no CTA** (ق14).

## Result (oud, red-first — `tests/certifier.gap7.test.mjs`)
- **Band correction alone:** `band_locked_out = 0` — every purchasable variant qualifies for some in-budget path
  (proves the 30-SKU gap is 100% the folded size dimension, 0% band-exact).
- **SKU-level I3 = 80/80** (picker): `not_arrived = []`; every in-budget purchasable variant is a selectable
  option with its own valid CTA.
- **node_kind:** terminal=3, display=8 (state distribution `{EXACT_AVAILABLE: 11}`).
- **Every size self-certified** (`invalid_cta = 0`); **default from the kernel** (`defaults_from_kernel = true`,
  `default_outside_options = 0`).
- **CTA guard:** an over-ceiling size on a `budget=mid` path is not purchasable (labeled), its CTA rejected
  (`cta_over_budget_ceiling`); a family url rejected (`cta_does_not_resolve_to_sku`).
- **Publish UNBLOCKED**; **mint stays 100%** (equivalence unchanged — the picker is a display surface, not the
  pick). The compiled artifact hash changed (node_kind is part of the structure) — a legitimate, recorded change.

## Consequences
- I3 now reaches 80/80 by **built capability**, not a metric change. `variant_unreachable`/`band_locked_out` are
  real measured reasons (both 0 on oud after the picker).
- **Backlog (quality, no reopen):** the kernel default is tie-broken by price (cheapest-first). Surfacing a
  richer default (e.g. best value per ml) is a ق14 tie-break refinement among equal-quality picks — a quality
  improvement, not a frozen-rule reopen.
- Not touched: axis-selection rule (frozen), gold, kernel. Live render / delivery / webhook / pull NOT started.
  Gold frozen (`gold-1.0.0`, sha OK); nothing softened.
