# ADR-0054 — Axis-selection rule v6: derived mirror metric + eligible-drop ledger

- **Status:** Accepted (implemented + proven); **two decisions surfaced for operator confirmation**;
  certification + wiring still NOT started.
- **Date:** 2026-07-28
- **Related:** ADR-0053 (`max-info-gain@v5`), `tests/btree.axisrule-v6.test.mjs`, `config/policy.json`,
  consultation round-6.

## Context
Round-6 review rejected v5's mirror guard on two grounds: (a) the singleton-share threshold (0.2) was a
**free-floating number** violating the house rule "a new numeric bound must state what it measures, its
denominator, and why that denominator is right"; and (b) it was **blind to all-size-2 distributions**
(singleton share 0 ⇒ passes, yet each answer isolates two products — a near-mirror). Also the v5 reachability
invariant covered only EXACT; a **compromise** candidate could still vanish from every branch silently (ق2).

## Decision — `max-info-gain@v6` (score unchanged)
1. **Derived mirror metric, in the score's own currency.** A mirror = "each answer leaves ≈ one candidate" =
   a small **expected residual pool size** `Σsᵢ²/S`. Reject an axis for branching when `Σsᵢ²/S < CAP`
   (integer: `Σsᵢ² < CAP·S`); **exempt when `S ≤ CAP`** (the whole pool already fits one display grid, so any
   split is at worst redundant, never a mirror). Replaces the singleton-share number.
2. **Eligible-drop ledger (extend the accounting, not the hard invariant).** `oracle.verifyReachability` now:
   the EXACT invariant stays hard (an exact candidate dropped by branching ⇒ build fails, ق2); and every
   parent-ELIGIBLE candidate (exact ∪ compromise) must stay eligible at ≥1 child **or be recorded with a
   named reason** (`unknown_on_axis:<A>`). An **unrecorded** drop ⇒ build fails. Reported metrics:
   `exact_drops` (=0), `unrecorded_eligible_drops` (=0), `recorded_drops[]`.
3. **Every mirror rejection is a reported axis GATE-FAILURE signal** (`tree.guardRejections`), not an internal
   brain event — a product-identity axis should have failed a conceptual/grounding gate before reaching the
   brain; the guard is a safety net and its firings are surfaced for the authoring layer.

## Two decisions SURFACED (per the house rule; not silently chosen)
- **CAP anchor.** The command said `leaf_primary_cap`, but `leaf_primary_cap=1` makes `Σsᵢ²/S < 1` **inert**
  (the ratio is ≥ 1 always) — it rejects nothing and fails the operator's own "all-size-2 ⇒ reject" test
  (proven in-test). **`leaf_total_cap` (=4)** is the anchor that satisfies all three stated tests (all-size-2
  reject · [10,1,1] accept · S=2 exempt-accept) and matches the concept. Used, and flagged in
  `policy._v6_mirror_note`. **Confirm.**
- **Denominator `S` vs `Σsᵢ`.** With `Σsᵢ²/S`, `S` includes the u₀ unknowns, so a **sparse-but-legitimate**
  soft axis is flagged as a mirror although its options don't fragment. On oud this fires **8 times, all on
  `origin`** (58% ungrounded): metric `/S` = 2.62/1.33/2.43/0.12 (reject) but `/Σsᵢ` = 6.24/3.00/3.40/1.00
  (mostly clear). Implemented the **literal `/S`** and **SHOWED** the false-positive rather than silently
  switching — operator to choose `S` (severe: penalizes sparsity) or `Σsᵢ` (measures fragmentation only).

## Consequences
- **Red-first proof** (`tests/btree.axisrule-v6.test.mjs`): the three mirror tests; `leaf_primary_cap`
  inertness; the v5→v6 gap (v5 accepts all-size-2, v6 rejects it); the `/S` sparsity false-positive; and the
  ledger — EXACT drop is a hard fail with a named reason, a COMPROMISE drop is recorded-and-allowed, RELAXABLE
  and oud are clean.
- **oud before/after (gold frozen by hash, never re-signed):** `root=type`, `depth=2`, `in_candidate_pool=80/80`
  unchanged, `surface@cap=55/80` (v5 was 61 — v6 suppresses `origin` questions on large pools as "mirror",
  the /S sparsity effect), `with_expansion=80/80` (GAP-7), `compromise=0%`, **reach ledger clean**
  (`exact_drops=0`, `unrecorded=0`, `recorded=[]`), **8 mirror gate-signals, all `origin`**.
- **v6 is AGGRESSIVE by design:** it rejects any axis whose expected residual < a display grid (unless the
  pool already fits one). The synthetic generalize catalogs were enlarged (buckets ≥ cap) so a discriminating
  axis survives; all-size-2/all-size-3 axes are now (per the operator's rule) gated as mirrors and shown as a
  grid. Generalize green on all three catalogs; eight stop conditions under v6; full suite green.

## Files
`authoring/brain2/axisRule.js` (`diagnoseAxesV6`/`chooseAxisByInfoGainV6`) · `authoring/brain2/tree.js`
(`RULE_V6` + rejection sink, default) · `engine/kernel/authoringOracle/authoringOracle.js` (`verifyReachability`
ledger + `_isGrounded`) · `config/policy.json` (`axis_rule_id`, `_v6_mirror_note`) ·
`tests/btree.axisrule-v6.test.mjs` (new) · `tests/btree.{generalize,fulltree}.test.mjs` (SC1 → v6; catalogs
enlarged). **Not touched:** compiler/Certifier, render, ingestion, wiring; gold.
