# ADR-0014 — Stage 2 step 1: derive decision axes from the catalog (deterministic)

- **Status:** Accepted
- **Date:** 2026-07-22
- **Scope:** Stage 2 authoring, first step. Standing operator approval for Stage 2.

## Context

Stage 2 turns the real catalog (Stage 1) into a complete funnel `config` the engine can
run. The design law (`docs/standards/decision-funnel-design-standard-v1.md`) is
**Results First, Questions Last**, built in order: Results → Eligibility → Signals →
Decision Matrix → Questions → Logic → Explanation → Trust. Every question must be able to
change the outcome (RULE 4); optimize for **strong signals, minimum questions** (RULE 7).

For a *catalog-driven* funnel the "results" are the real products (or product groups), and
the funnel's job is to separate them. So the foundational step is: **find the attributes
that actually differentiate the products** — the *decision axes*. A question is only worth
asking if it maps to an axis that splits the catalog; otherwise it is theater (RULE 4).

This ADR covers **how we derive those axes from a real catalog** (grounded on the live
oudfactory catalog as the test sample), not yet the questions or logic.

## Options considered

1. **Hand-author axes per client.** Rejected: doesn't scale, and it's the manual step every
   competitor already requires — the opposite of the moat.
2. **LLM reads the catalog and proposes axes.** Powerful, but: costs money/keys (operator's
   call), is non-deterministic (hard to test), and risks *inventing* an axis the data
   doesn't support (fabrication). Deferred to its own ADR (mirroring ADR-0013's structured-
   first, LLM-deferred stance).
3. **Deterministic derivation from the product data itself.** Chosen for v1: analyze the
   real fields (price, product type/category, tags/differentiators, and recurring
   title/description keywords), score each candidate axis by how well it *discriminates*
   the catalog, and rank. No cost, fully testable on a saved fixture, and it can only
   surface distinctions the data actually contains — no fabrication.

## Decision

Add `authoring/author/axes.js` — `deriveAxes(catalog)` → a ranked set of **decision axes**,
each grounded in real products:

- **Structured categorical axes:** price (tertile bands: budget / mid / premium, only when
  enough products are priced and prices spread), product **type/category** (from
  `attributes.type`), and **brand** (when it varies). Each value lists the **real product
  URLs** that fall under it (provenance preserved).
- **Keyword facets:** tokenize titles + differentiators, drop stopwords/noise, keep terms
  with document-frequency in a *discriminating* band (appear in **some** products, not
  ~all and not just one), rank by discrimination. These are the raw material a later step
  clusters into categorical axes (e.g. oud *origin*, *form*, *size*).
- **Scoring:** each axis gets a `discrimination` score (normalized entropy of its value
  distribution — high when it splits the catalog evenly) and `coverage` (fraction of
  products it classifies). Non-discriminating axes (a single value, or one value covering
  ~everything) are dropped — they can't change an outcome (RULE 4).

Pure, deterministic, dependency-free, Node-safe. Output feeds the next Stage-2 steps
(result architecture → decision matrix → questions). Tested offline against the real
oudfactory catalog fixture; **no product or attribute is invented** — every axis value
traces to real products.

## Consequences

- The funnel's questions will be grounded in attributes that genuinely separate the
  client's real products — satisfying RULE 4/7 by construction.
- Deterministic + fixture-tested keeps Stage 2 green and honest; an LLM axis-refiner can
  later *augment* (its own ADR, with the cost decision surfaced to the operator) but never
  replaces the provenance guarantee.
- Sites with too few discriminating attributes surface that honestly (few/low-score axes)
  → the signal to fall back to a vertical template rather than fabricate a decision.
