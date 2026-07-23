# ADR-0018 — Mine decision axes from product names (co-occurrence clustering)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Scope:** Stage 2 authoring. Standing operator approval for Stage 2.

## Context

The **live oudfactory proof** (review session) was the right kind of failure: ingestion
pulled **50 real products**, but authoring **refused honestly** (`no-nonbland-funnel`) —
the anti-bland gate (ADR-0016) held. Root cause: on real oud stores the catalog's richness
lives in the **product names** (form: Oil/Wood/Bakhoor/Parfum; origin:
Kalimantan/Indian/Cambodian; size: 3ml/Tola), while the structured `product_type` is coarse
(Perfumes / Agarwood / Gift Card). So only **price** discriminated → one question dominated
→ correctly rejected. The prior facet handling (ADR-0017) lumped all top name-terms into a
single incoherent axis, mixing form with origin, which never yielded two clean axes.

Per the standard, the fix is to **improve the generation** (mine better axes), never weaken
the gate.

## Decision

Two additions to `authoring/author/axes.js`, both **deterministic and general** (no
hardcoded oud vocabulary):

1. **Non-product cleaning** — `cleanCatalog(products)` drops obvious non-products (gift
   cards, samples, vouchers, shipping, fragrance "experiences", warranties, subscriptions)
   before any axis is derived, so the decision is built from real, differentiating products
   only. (A gift card is a real product but must never be "the oud for you".)

2. **Co-occurrence facet clustering** — `facetAxes(products)` mines the names/tags:
   - keep discriminating terms (document-frequency band);
   - two terms **co-occur** (appear together in a product) ⇒ they describe **different**
     dimensions ⇒ different axes; terms that **don't** co-occur are **alternatives** ⇒ the
     **same** axis;
   - greedy graph-coloring groups terms so each axis's values are mutually exclusive (a
     product carries at most one), producing coherent axes like **form** and **origin**
     automatically — for any catalog, not just oud.

   `deriveAxes` now returns these facet axes alongside the structured ones; the generator
   (ADR-0017) consumes them as fact axes, so a name-rich catalog yields ≥2 strong axes and a
   non-bland funnel. If names still carry no exploitable richness (only price varies), the
   generator **still refuses** (`not-enough-fact-axes` / `no-nonbland-funnel`) → honest
   template fallback, never a bland or fabricated funnel.

Tests: a **synthetic oud-shaped fixture** (`tests/fixtures/oud-shaped.synthetic.json` —
invented names on an example domain, **no real client data**) must now author a funnel that
passes schema + trust + **anti-bland**, with the Gift Card cleaned out and every result a
real product; and a coarse "only price varies" catalog must still be refused.

## Consequences

- Real name-rich catalogs (oud, perfume, fashion — richness in names) now yield ≥2 genuine
  fact axes and a non-bland funnel; the oudfactory case that legitimately refused before now
  authors.
- The clustering is domain-agnostic (co-occurrence, not a vocabulary), so it generalizes to
  other verticals; non-product cleaning keeps decisions on shoppable items.
- The anti-bland gate was **not** touched — the fix is entirely on the generation side
  (better axes), exactly as the standard requires.
- Size/concentration is mined too **when it appears in names** (e.g. "3ml", "Tola");
  extracting sizes from Shopify **variant options** when they're *not* in the name is a
  separate, later enhancement (its own note) — not needed for ≥2 axes here.
