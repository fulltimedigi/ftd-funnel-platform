# ADR-0034 — Format is a HARD constraint, not a soft preference

Status: Accepted · 2026-07-24

## Context

On live oudfactory the operator proved a methodical, trust-breaking bug: picking
**spray perfume + woody** returned *Indian Mouri Agarwood* (a raw wood block). Root cause,
by line and number, in `authoring/author/index.js`:

- `_assignCovering().score(p, combo)` weighted **every** axis equally: a match = `+1`, a
  mismatch = **`-0.001`** (essentially free). So a raw-oud product matching (woody +
  budget + intensity) scored `+3` and **beat** a real spray matching (format + woody)
  `+2`. The shopper's explicit **form** choice was overridden by other axes. The same
  blindness lived in the Pass-2 fill and in the coverage-backfill `simTo`. Each "format"
  path pulled 26 of 50 products — form was effectively ignored, both directions.

A product's **form** (spray / oil-attar / raw wood-bakhoor / set) is a **fact of the
catalog**, not a soft dimension the AI may re-weight. "I want a spray" must mean *only
sprays*.

## Decision

1. **Hard axes.** An axis may declare `hard: true`. In the covering assignment a hard
   mismatch is an **absolute exclusion** (`score → -Infinity`; the product can never win
   that combo), a `null` value is a wildcard (eligible). This applies uniformly to
   `score()`, the Pass-2 fill (only finite-score products may win), and the backfill
   `simTo()` (an orphan attaches only to a **same-form** archetype).
2. **Deterministic format axis (`formatAxis.js`).** `productFormat(p)` derives the form
   from the real store text (title + `attributes.type` + tags) via a priority keyword map
   (oil & perfume beat the generic "set/box" — an *Oud Oil Set* is oil, a *Wood Box* is
   raw; Arabic + English, case-insensitive). Unmatched → `null` (eligible for any form, so
   nothing is orphaned). `deriveFormatAxis` builds the `hard:true` axis (only forms that
   exist; needs ≥2). The **AI may not touch it** — form is a fact, not a design.
3. **Always partition by form.** `authorFromAxes` (AI) and `authorFunnel` (deterministic)
   inject the format axis into every candidate set and drop any AI/mined axis that
   *duplicates* form (`looksLikeFormatAxis`, matched on strong form phrases only — never
   bare "wood", which lives inside the *character* value "woody").
4. **Real soft cost.** The soft-axis mismatch penalty is raised `-0.001 → -0.5`, so
   budget/character still matter as a secondary signal — but **within** the chosen form.

## Consequences

- **Zero cross-form leakage:** for every decision rule, the recommended product's real
  form equals the rule's chosen form (locked by `tests/format-hard.test.mjs`). Spray →
  only sprays; raw → only raw.
- **Coverage stays ~100%, honestly** — now achieved *within* each form (each product is
  the #1 for a path of its own form). The maths didn't shrink; it got truthful. Combo
  budget raised (200 → 400) to leave room for the partition.
- **No gate weakened, no fabrication.** Trust + anti-bland + richness are unchanged and
  still pass; form is a real fact from the catalog. Runtime stays deterministic.
- Applies to both authoring paths (both compile through `buildConfig`/`_assignCovering`).
  Preview only; live untouched.
