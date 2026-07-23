# ADR-0031 — Covering assignment: every product reachable ("Results First, Questions Last")

Status: Accepted · 2026-07-23 · applies to BOTH the deterministic and AI-enriched paths

## Context

The operator read the assignment code and caught a real **brain** flaw that violates our
core law. In `buildConfig` (authoring/author/index.js) the decision table was built by
pure **argmax**: for every answer-combination we picked the single best-matching product.
A product appeared as a result **only if it won ≥1 combination**. Central/common products
win many combos; niche products win none. On oudfactory, ~60% of the 51 products won no
combo → **unreachable, never recommendable, unsellable** → coverage ~40%.

This is backwards. Our law is **"Results First, Questions Last"**: start from *all*
products (the results) and design questions that distinguish them, so **every product is
the answer for some shopper's profile**. Done right, coverage approaches ~100% by
construction. We were doing the reverse — generate questions, then see who wins — which
orphans half the store.

Decisiveness is NOT in tension with coverage:
- **Per shopper:** still exactly one clear #1 pick (+ optionally 2–3 real nearest
  alternates). Never a catalog dump / spinner.
- **Across shoppers:** every product is the #1 for *some* answer path → the whole catalog
  is in the scoring. These compose: always a clear #1, and every product owns a path.

## Decision

**1. Covering assignment (`_assignCovering`).** Instead of argmax-per-combo:
- Each product's **home combo** = the answer-combination that matches its own axis
  profile (for a full profile, its exact values; for a partial profile, its best match).
- Every product **owns** its home combo — it is the #1 result there. Products that share
  an identical profile (genuine near-duplicates) share that leaf as a **ranked list**:
  a clear #1 + up to 3 real nearest **alternates** (`recommendations.contextual`), which
  the coverage metric counts as reachable.
- Combos that are no product's home are filled by **best match** (they route to an
  already-reachable product). Result: with distinct profiles, coverage = ~100% from
  primaries alone; twins are recovered as alternates.

**2. The AI must SPREAD the catalog.** The enrichment prompt now requires distinct
per-product profiles and enough answer-combinations that `#combos ≥ #products`, so each
product can be someone's #1. The repair feedback names low coverage explicitly and asks
for a discriminating axis / re-spread — turning "full reachability" into the depth the
operator already wants.

**3. Raise the coverage gate (a gate that can't fail is theater).** `richnessCheck`
`minCoverage` 0.25 → **0.90** for catalogs that justify depth (≥12 products). A funnel that
orphans most of the catalog now **fails** and triggers repair/deeper axes instead of
shipping. A synthetic low-coverage funnel is asserted to be rejected in tests.

**4. Optional richness of result.** Each result may carry 2–3 real nearest alternates
("قد يناسبك أيضاً") — improves store exposure per shopper and matches the reference cards,
without becoming a dump (hard cap 3, per UX_INTERFACE_DECISION).

## Consequences

- **No fabrication.** Every primary and every alternate is a real catalog product with a
  real URL and an answer-grounded reason. The covering assignment only changes *which real
  product* owns a path — it never invents one. Runtime stays deterministic.
- **Coverage ~100%** when the answer-space allows (enough discriminating questions). When
  it doesn't, the gate fails honestly and the AI repairs by adding depth — never by
  padding an unjustified question (anti-bland still applies) and never by weakening a gate.
- Both paths benefit: `authorFunnel` (deterministic) and `authorFromAxes` (AI) compile
  through the same `buildConfig`, so the covering assignment and gate apply to both.
- Tests: a covering-coverage test proves ~all products are reachable on a synthetic
  catalog with distinct profiles, and a low-coverage funnel is proven to fail the gate.
- Preview only; live untouched. Design model stays `claude-opus-4-8`.
```
