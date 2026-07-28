# ADR-0064 — Real per-size certificates (no derived hash), node_kind cap from policy, price-range honesty

- **Status:** Accepted (built + proven, red-first). Publish: **UNBLOCKED** on oud (SKU-level I3 = 80/80 on REAL
  kernel certificates). Live render / delivery / webhook / pull NOT started.
- **Date:** 2026-07-28
- **Corrects:** ADR-0063 (its per-size `selection_result_id` was a derived hash). **Related:** ADR-0058 (frozen
  axis selector v10), `engine/kernel/certifier.js`, `authoring/compiler/structuralCompiler.js`, `config/policy.json`,
  `tests/certifier.gap7.test.mjs`, consultation round-12 (follow-up).

## Context — a hash is an identifier, not a certificate
A review question exposed the hole: ADR-0063 gave each selectable size a `selection_result_id = fnv(leaf|sku)`
— a **derived hash**, not a real proof. So every non-default size's buy button was **unproven** (ق21 breach),
and the green I3 was partly resting on **identifiers masquerading as certificates**.

## Decision
### 1. A REAL `SelectionResult` per selectable size (blocking)
Each selectable size now carries a `SelectionResult` **minted by the kernel** (`select` over that one variant,
on that path) — no derived hash, no authored id. The guard `isMintedCertificate(cert, sku)` accepts only a
**frozen** kernel result that resolves to exactly this sku and carries a `policy_hash` (only `makeSelectionResult`
produces it). The Certifier counts a size as surfaced **only** via a real certificate; `uncertified` counts any
option without one, and I3 requires `uncertified === 0`. **Test:** a derived hash, a hand-built plain object, and
a real certificate for a *different* sku are all **rejected**; only the real minted result passes.

### 2. node_kind cap from policy (constitution ≤ 3), decoupled from the tree semantic-stop
`leaf_primary_cap` served double duty: the **tree's semantic-stop** (when to stop branching — the frozen v10
fixture depends on it, `= 1`) AND the **node_kind** decisiveness cap. These are different concepts. Added
`display_contract.primary_cap = 3` (constitutional default, owned by the display contract). node_kind now reads
the **display** cap: `terminal ⟺ 1 ≤ exact ≤ 3`; `exact > 3 ⇒ display` grid; `exact = 0 ⇒ display`. The tree's
semantic-stop stays `1` — **untouched**, so the frozen axis selector is undisturbed. On oud: **terminal=6,
display=5** (was 3/8 under cap=1). A cap of 1 was a config error (an "it", not a definition).

### 3. Price-display honesty
A multi-size family spans a price range. The card now carries `price_from` / `price_to` / `price_is_range`; the
Certifier's `missing_range` counts any multi-price card that fails to show a range, and I3 requires it `= 0`. A
single price masquerading as THE product price is barred.

### 4. The default stays kernel-owned; price is only the kernel's tie-break key.

## Result (oud, red-first — `tests/certifier.gap7.test.mjs`, 8 checks)
- **SKU-level I3 = 80/80 on REAL certificates** (`uncertified = 0`, `certificates_minted_by_kernel = true`). The
  expected drop-and-return did not occur: every in-budget purchasable variant genuinely mints (the individual
  kernel `select` succeeds), so the honest number is 80/80 — now on real proofs, not hashes.
- **Hash-replacement rejected:** derived hash / plain object / wrong-sku certificate all fail the guard.
- **node_kind:** terminal=6, display=5 (display cap = 3 from policy; tree stop = 1 untouched).
- **Price range:** `missing_range = 0`. **Default from kernel:** `defaults_from_kernel = true`,
  `default_outside_options = 0`. **band_locked_out = 0.**
- **Publish UNBLOCKED**; I1 & I2 green; **mint stays 100%**; the certificate mints. Artifact hash changed
  (node_kind is structural) — legitimate, recorded.

## Recorded (per the operator)
1. **Two sources of truth for bands** — design-time band-exact (frozen fixture) vs certify-time variant ceiling —
   are **accepted for now** because the conflict **fails loudly**: `band_locked_out` is a guard, not a silent
   drop. **Declared trigger for the fix:** the **first catalog that yields `band_locked_out > 0`**. The freeze
   (ADR-0058) covers **`rankAxesV10` only**; band derivation is an **acceptance gate**, not frozen — so the fix
   is permitted, deferred by an explicit operator trigger.
2. **Backlog (quality, no reopen):** a richer default (best value per ml) — a ق14 tie-break among equal-quality
   picks. Price-tie-break (cheapest-first) is the current kernel default.

## Consequences
- Every buy button on every selectable size is backed by a real kernel certificate (ق21 satisfied). I3's 80/80 no
  longer rests on any identifier-as-proof.
- Not touched: axis-selection rule (frozen), gold, kernel. Gold frozen (`gold-1.0.0`, sha OK); nothing softened.
