# ADR-0065 — Catalog-snapshot membership folded into the mint (+ singleton-soundness guard)

- **Status:** Accepted (built + proven, red-first). Pre-delivery correction (STOP-1 of the delivery command).
  Publish: still UNBLOCKED on oud (I3 = 80/80). Wiring / delivery NOT started.
- **Date:** 2026-07-28
- **Related:** ADR-0064 (real per-size certificates), `engine/kernel/certifier.js`, GAP-3 (catalog drift),
  `tests/certifier.gap7.test.mjs`, consultation round-12 (delivery, step 1).

## Context — two separable checks are a drift hazard
A size's certificate proved "this sku satisfies the path", but **catalog-snapshot membership** ("this sku is in
the shipped snapshot") was checked separately (`validateCta` via `skuMeta`). Two separable checks can drift —
most dangerously under catalog drift (GAP-3): a certificate could exist for a sku no longer shipped.

## Decision
### 1. Membership folded INTO the mint (blocking)
The per-size mint (`select([variant], …)`) now receives the **catalog snapshot** as `catalogUrls`; the kernel's
`verify` refuses a unit absent from it, so `makeSelectionResult` never mints a certificate for an out-of-snapshot
sku. The Certifier takes `ctx.catalogSnapshot` (a `Set` of shipped sku ids; defaults to the `skuMeta` keys) and
threads it through the mint. A sku absent from the snapshot is labeled `not_in_snapshot` and **not surfaced** —
regardless of its offer data or `validateCta`. **Test:** remove one sku from the snapshot but keep its offer data;
I3 goes red (surface 79/80), the sku's reason is `not_in_snapshot`, and `validateCta` STILL passes for it —
proving the gate is the **mint**, not the downstream check.

### 2. Singleton-soundness guard (my answer #1, made executable)
Certifying a size via a singleton `select` is sound **only while no comparative rule exists** (one that
excludes/promotes a candidate because of another). Guard: the group winner, evaluated ALONE, must be identical
(same pick, same match_state); a divergence sets `comparative_leak`, and I3 requires `comparative_leak = 0`. On
oud: 0.

### 3. Legible band-lockout (my answer #2)
`not_arrived_detail` now names `family_id` + `price` per sku, and the grid carries a `band_locked_out_message`
listing the family·size@price of every locked-out sku — so the day `band_locked_out > 0` fires, it is legible on
sight.

## Result (oud, red-first — `tests/certifier.gap7.test.mjs`, 10 checks)
- **Membership-in-mint:** a removed sku ⇒ I3 red (79/80), reason `not_in_snapshot`, while `validateCta` still
  passes ⇒ the gate is the mint. `membership_in_mint = true`.
- **Singleton-soundness:** `comparative_leak = 0`.
- Full snapshot: I3 = 80/80, mint 100%, publish unblocked (unchanged).

## Consequences
- No certificate can be minted for a sku missing from the referenced snapshot — the primary defense against
  catalog drift (GAP-3) now lives where the proof is minted.
- Not touched: axis-selection rule (frozen), gold, kernel, pull. Gold frozen (`gold-1.0.0`, sha OK); nothing
  softened. **Next (on operator's go-ahead): the delivery itself — pipeline factory, wiring, service traces,
  no-return guard, re-measure through production.**
