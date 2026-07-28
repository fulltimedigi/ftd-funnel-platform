# ADR-0061 — GAP-7: the ق20 oversized-leaf comparison grid (publish unblocked)

> **⚠️ CORRECTED by [ADR-0062](0062-sku-level-i3-and-node-kind-integrity.md) (round-11).** The "publish
> unblocked / I3 80/80" claim below was measured at the **FAMILY** level — it counted a family as accounted and
> silently credited ALL its variants, so `variant_unreachable = 0` was true *by construction*, not by
> measurement. Re-measured per SKU, I3 is **50/80** and **publish is RE-BLOCKED** (30 variants stranded; the
> variant/size picker is unbuilt). The grid *structure* here stands; the *metric* and the unblock are retracted.
> Read ADR-0062 for the corrected measure. The text below is kept for the record.

- **Status:** **Superseded by ADR-0062** (family-level metric retracted). Grid structure retained; publish
  status reverted to BLOCKED. STOPPED after GAP-7 (operator: "توقّف بعدها"). Delivery / render / wiring / pull
  NOT started.
- **Date:** 2026-07-28
- **Related:** ADR-0058 (freeze v10), ADR-0059 (compiler), ADR-0060 (certifier), `config/policy.json`
  (`display_contract.grid`), `engine/kernel/certifier.js` (`resolveGrid`), `tests/certifier.gap7.test.mjs`,
  `docs/KNOWN-GAPS.md` (GAP-7), consultation round-10.

## Context — the blocker
The Certifier (ADR-0060) proved the compiled artifact faithfully represents the kernel (mint 100%, tree↔runtime
equivalence on 11/11 leaves) — but **I3 (NoActiveSKUWithoutAccountingOrWitness) was RED at 61/80**. The runtime
display shows only a **capped** surface (`leaf_total_cap`), so 19 real SKUs were neither surfaced, grid-accounted,
nor witnessed. The measured cause was single: every one of the 19 is **`family_buried`** (0 `variant_unreachable`)
— they sit inside a leaf's full candidate pool but fall below the display cap. This is a **display debt**, not a
ranking fault (ADR-0058 ruling: `surface@cap` is a regression baseline, not an axis-selector reopen signal).

## Decision
An oversized display leaf (ق20) is **NOT pruned**. It surfaces a **comparison grid of EVERY candidate**
(`surface = all_candidates`, `hide_ties = false`), each card carrying:
- the product's **REAL CTA** — its catalog URL, authorized by the certificate (ق21). No generic button, no
  fallback. A card with no real CTA is **not counted** as surfaced.
- **descriptive attributes** (title, type) visible on the card (PRODUCT_DECISIONS).
- a **declared order** (exact first, then compromise, by id) + a **`tie_break_reason`** per card.

Scope is bounded by the measured cause (`family_buried`); **the axis-selection rule (v10) is untouched.**

### Where each rule lives (separation preserved)
- **`config/policy.json` → `display_contract.grid`** — the contract, owned by the DISPLAY layer (versioned
  `display-1.0.0`). The `_status: PROVISIONAL` marker was removed; the grid is now real.
- **compiler (`structuralCompiler.js`)** — a display leaf **declares** the grid structurally
  (`grid: { surface: "all_candidates", hide_ties: false, count: resolved }`). The compiler does **not** order,
  CTA, or phrase — it carries the STRUCTURE only (leak boundary intact; artifact bytes unchanged by GAP-7).
- **Certifier (`certifier.js` → `resolveGrid`)** — kernel-side, RE-DERIVES each leaf's full candidate set,
  orders it, and attaches the real CTA + attributes from `catalogMeta`. I3 becomes
  `accounted = surface_reachable_with_grid` (union of families surfaced WITH a real CTA), and holds only when
  `missing_cta = 0` and there are no grid findings (no hidden tie).

## Result (all numbers as-is — red-first, `tests/certifier.gap7.test.mjs`)
- **I3: 61/80 → 80/80.** `surface_reachable_with_grid == with_expansion (in_candidate_pool) == 80/80 == active`.
- **`not_arrived = []`** — every active SKU is grid-accounted.
- **Every CTA from the certificate:** `cta_from_certificate = true`, `missing_cta = 0`, `missing_attributes = 0`.
- **No hidden tie:** `hide_ties = false`, grid findings `= []` (each grid surfaced exactly its declared count).
- **Publish UNBLOCKED:** I1 & I2 stay green; **I3 flips green**; the certificate still mints; **mint rate stays
  100%** — GAP-7 is a DISPLAY surface, it never re-derives the pick, and the compiled artifact bytes are
  **byte-identical** (test 7).
- **surface@cap floor preserved (61)** in `tests/btree.axis-selector-freeze.test.mjs`; the delivered reach (80)
  is recorded alongside it — the cap floor never regresses; the grid delivers full reach.

## Consequences
- The pipeline is now **publishable on oud**: tree → compiler → CertificationInput → Certifier (re-derivation)
  → certificate → **I3 green**. The 19 buried SKUs are reachable via the grid, each with a real CTA.
- GAP-7 in `docs/KNOWN-GAPS.md` moves from PUBLISH BLOCKER to **CLOSED (built)**.
- **Not touched (stop-point):** live render of the grid UI, delivery, webhook, pull, wiring. Those remain
  explicitly out of scope until ordered.

## Review discipline (GAP-7 component, round 1)
| Finding | Class | Detail | Blocks? |
|--------|-------|--------|--------|
| The grid counts a family as "surfaced" only when its card has a real CTA; a family with a null URL would silently drop from `surface_reachable_with_grid` (caught by `missing_cta`/`not_arrived`, not silently). | integrity (guarded) | On oud every family has a real `url`, so `missing_cta = 0`; the guard makes a missing CTA a VISIBLE failure (I3 red), never a silent pass. | No — guard holds; verified 0 missing on oud. |
| `node_kind terminal/display` still derived from `resolved ≤ cap` (a decisive 1-exact-pick + alternates leaf is labeled `display`). | quality (carried from ADR-0060) | No effect on the grid, CTAs, or I3; leaf STATE distribution stays `{EXACT_AVAILABLE: 11}` (funnel decisive). | No — backlog. |

No safety finding surfaced. Nothing softened; gold frozen (`gold-1.0.0`, sha OK).
