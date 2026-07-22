# ADR-0010 — Build the `personas` result layout (stop falling back to `tracks`)

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

Stage 0 (ADR-0003) lists "build the `personas` result layout (currently falls back)" as
a gap. The engine ships three result layouts in the schema enum
(`resultLayout: personas | commerce | tracks`), and the dispatch in
`engine/resultRenderer.js` renders `tracks` (score-distribution) and `commerce`
(signature product + contextual grid) — but `personas` fell through to `tracks`:

```
case "tracks":
case "personas": // personas variant not built yet — falls back to tracks
```

So any funnel declaring `personas` silently got the assessment/score layout instead of a
coaching/profile one. The production engine has a `personas` body: strengths / gaps /
next-steps lists read from the archetype's `resultExtras`, but it is written against the
production DOM class names and its own component set, not this engine's `ftd-` classes and
shared helpers.

## Options considered

1. **Copy the production `_renderPersonasBody` verbatim.** Rejected: different class names
   and helper set — it wouldn't match this engine's DOM or reuse its shared cards, and
   would duplicate the hero/blend/traits logic.
2. **Leave the fallback; treat `personas` as an alias of `tracks`.** Rejected: the schema
   advertises three distinct layouts; a coaching funnel that asks for `personas` deserves
   the coaching presentation, and the gap is explicitly tracked in ADR-0003.
3. **Build `renderPersonas` on this engine's shared helpers, wire the dispatch, and cover
   it with a test.** Chosen.

## Decision

**Option 3.** Add `renderPersonas(ctx)` to `engine/resultRenderer.js`, reusing the
existing shared building blocks (`heroCard`, `traitsBlock`, `blendBlock`,
`recommendationCard`, `ctaLink`, `restartButton`, `fillBecause`) so it stays consistent
with the other layouts and there is one source for the hero/blend/recommendation:

- Body: **who you are** (hero + description + traits + localized blend) then
  **strengths (💪) / gaps (🎯) / next-steps (✅)** rendered from
  `primary.resultExtras.{strengths,gaps,actions}` via a small `personaList` helper.
- Each list is **omitted when not authored** — no empty sections, no fabricated content
  (rule 3). Numerals inherit the ADR-0008 localization through the shared blocks.
- The **primary recommendation** renders only when its `because` resolves — the same §9
  rule every layout honours.
- Dispatch: `case "personas": return renderPersonas(ctx);` (fallback removed).
- Styling: persona classes added to `styles/base.css` using **logical properties**
  (`border-inline-start`, `padding-inline-start`) so RTL flips automatically — no
  `rtl.css` change needed.

New `tests/personas.test.mjs` drives a `personas`-configured funnel and asserts the body
renders (strengths/gaps/actions titles + items), that it is **not** the `tracks` fallback
(no score-distribution), that the root carries `ftd-result-personas`, and that it degrades
gracefully (partial or absent lists). The test's DOM shim was given the
`firstChild`/`lastChild` getters that `mount()`'s `clear()` needs, so each screen replaces
the last (a subtle shim bug that would otherwise let stale screens accumulate).

## Consequences

- `personas` is now a real, distinct layout; the three advertised layouts all render their
  own presentation, closing the ADR-0003 gap.
- Coaching / B2B funnels can present a strengths–gaps–actions profile grounded in the
  archetype data, with the same trust rules and RTL/numeral behaviour as the other layouts.
- The shared-helper reuse means future changes to the hero/blend/recommendation card apply
  to all three layouts at once.
- Follow-up: a full `personas` **example config** (a demo coaching funnel) can be added
  when a real coaching engagement needs one; the layout and its test are ready for it.
