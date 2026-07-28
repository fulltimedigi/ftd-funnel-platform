# ADR-0062 — SKU-level I3 (the family metric was blind), the CTA validity guard, and the node_kind integrity fix

- **Status:** Accepted (measured + proven, red-first). Publish status: **BLOCKED** (reverting ADR-0061's
  family-level unblock). STOPPED after this correction. Delivery / render / wiring / pull NOT started.
- **Date:** 2026-07-28
- **Supersedes:** ADR-0061 (family-level metric). **Related:** ADR-0058/0059/0060, `engine/kernel/certifier.js`,
  `authoring/compiler/structuralCompiler.js`, `tests/certifier.gap7.test.mjs`, `docs/KNOWN-GAPS.md` (GAP-7),
  consultation round-11.

## Context — the family metric hid a real gap
ADR-0061 declared I3 (NoActiveSKUWithoutAccountingOrWitness) green at 80/80 and publish unblocked. That was
**wrong**. The measure counted a **family** as accounted and then credited **every SKU of that family**. So:
- A grid card carries **one** CTA → one variant. A multi-variant family (e.g. `5-tola-wood-box`: 6 sizes,
  1575–2660 AED) is surfaced by one card → **one** variant reachable; the other five are **not selectable via
  the funnel**. The family metric credited all six anyway.
- Worse, a card's CTA can lead to a variant **priced above the path's stated budget ceiling** — the promise
  breaks at purchase (constitution defect #6). The family metric never checked the variant's price.
- **The decisive point:** `variant_unreachable = 0` was true **by construction** ("family reachable ⇒ all its
  SKUs accounted"), **never by measurement**. It was that way since Part 1 — and it is exactly why deferring the
  variant/size picker looked safe. **It was not safe; it was unmeasured.**

## Decision
### 1. Measure I3 at SKU granularity (blocking)
For **each active SKU individually** (`engine/kernel/certifier.js` → `resolveLeafSkus`):
- **Surface Witness** — the SKU appears as a **selectable** option in a reachable leaf. A family showing is not
  enough. The runtime pins **one** variant per family card (the cheapest in-budget available variant,
  deterministic by price then id); a family's extra sizes have **no** selection path.
- **Purchase Witness** (available SKUs) — a CTA that **resolves to that SKU** (its own `buy_url` + price), is
  **present in the shipped catalog snapshot** (`skuMeta`), and **satisfies the path's hard budget ceiling**.

`surface_reachable_with_grid` = count of SKUs with a valid pinned CTA. Each not-arrived SKU carries a reason:
`family_buried` (family never pinned anywhere) · `variant_over_ceiling` (priced beyond every path it could
appear on) · `variant_unreachable` (family surfaced but this variant is not individually selectable — the
unbuilt size picker).

### 2. The CTA guard: existence → validity (`validateCta`)
A CTA is valid only when it (a) resolves to a specific SKU (`cta_url === that sku's buy_url` — a **family url is
not** a per-variant CTA), (b) that SKU is in the shipped snapshot, and (c) the SKU satisfies the answered band's
budget ceiling. A CTA to a variant over the ceiling ⇒ **rejected** (`cta_over_budget_ceiling`), not surfaced.

### 3. Publish blocker restored
I3 stays **RED** until measured at the SKU level **and** reaching 80/80 with both witnesses. The ADR-0061
unblock (family metric) is **reverted**.

### 4. node_kind integrity fix (was quality, now integrity)
`node_kind` was `resolved ≤ leaf_primary_cap ? terminal : display`, so a decisive **1-exact-pick** leaf padded
with compromise alternates was mislabeled `display`. The **live render layer reads node_kind** and would build
that leaf as a pick-one grid — wrong. Fixed: **`terminal ⟺ exact ≥ 1`** (a decisive result; alternates ride a
comparison surface), `display ⟺ 0 exact` (COMPROMISE_ONLY). The oversized-grid declaration (ق20) is now
**orthogonal** (`resolved > leaf_primary_cap`), carried on either kind.

### 5. Grid ordering — unchanged (backlog)
Alphabetical-by-id is deterministic and declared (passes the law). Price ordering **within the exact group** is
constitution-legitimate (ق14, a tie-break among equal-quality picks) and better UX — a **quality** improvement,
**not** a reopen of any frozen rule. Logged to backlog.

## Result (oud, red-first — `tests/certifier.gap7.test.mjs`)
- **SKU-level I3 = 50/80 (RED).** `not_arrived = 30`, all `variant_unreachable` (the extra sizes of the 11
  multi-variant families — e.g. 5 of the `5-tola-wood-box`'s 6 sizes). `family_buried = 0`, `variant_over_ceiling
  = 0` (we pin the cheapest in-budget variant).
- **CTA guard:** a CTA to an over-ceiling variant on a `budget=mid` path → **rejected** (`cta_over_budget_ceiling`);
  a family url → **rejected** (`cta_does_not_resolve_to_sku`); the SKU's own `buy_url` with no ceiling → valid.
- **Publish: BLOCKED** — 30 SKUs lack a witness. The unblock awaits the **variant/size picker** (unbuilt), not a
  metric change.
- **node_kind:** state distribution `{EXACT_AVAILABLE: 11}`; node_kind now `terminal=11, display=0` (every
  EXACT_AVAILABLE leaf is correctly terminal). The compiled artifact hash changed (node_kind is part of the
  structure) — a legitimate structural change, expected.
- **Mint rate stays 100%** — tree↔runtime equivalence is unchanged; the gap is **display reach**, not the pick.
  The certificate still mints.

## Consequences
- `variant_unreachable = 0` is **retired as a by-construction artifact**; it is now a measured, non-zero number
  (30 on oud). The size gap is visible for the first time since Part 1.
- The next real step to publish is the **variant/size picker** (surface every in-budget variant as selectable,
  each with its own valid CTA) — a build, deliberately **not** done here (would be "fixing the number").
- Not touched: live render, delivery, webhook, pull. Gold frozen (`gold-1.0.0`, sha OK); nothing softened.
