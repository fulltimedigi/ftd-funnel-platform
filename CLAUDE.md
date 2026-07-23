# CLAUDE.md

Operating guidance for Claude Code in the **FTD Funnel Platform** repo.

## What this is

The FullTimeDigi flagship: **brand URL → an AI-authored, trust-validated interactive
funnel that recommends real products with real reasons.** Built to compete globally.
Destination: **fulltimedigi.com**. Read `README.md`, then `docs/ARCHITECTURE.md` and
`docs/ROADMAP.md`.

This repo was seeded from `fulltimedigi-engine-v0` (the only engine with green tests)
and merges the `ftd-diagnostic-engine` production runtime in, test-green-gated. See
`docs/adr/0003-engine-blend-start-from-v0.md`.

- Run tests: `npm test`  ·  Serve: `npm run serve` (http://localhost:8000)

## Who you're working with (read first)

The operator (product owner) is **not a developer or programmer.** Work with them
accordingly, at all times:

- **Communicate in plain, simple Arabic.** No jargon dumped without a plain-language
  explanation. Explain progress like you'd explain it to a smart non-engineer.
- **You own the technical work.** The operator owns the vision and the approvals — not
  implementation. Never hand them technical decisions or make them configure things.
- **When a real choice needs them,** present it as simple plain-language options **with
  your recommendation**, not a technical trade-off table.
- **If you need something done by hand** (a setup step, a key, a repo, a deploy): do it
  yourself if you can; if only they can, give **dead-simple click-by-click steps**, and
  prefer a small visual step-by-step guide over a wall of instructions.
- **Never report success you can't confirm**, and never imply something works when it
  doesn't — in plain terms.

This does **not** lower the engineering bar: still research the best option before each
step, still write an ADR for each decision, still keep tests green. It only changes
*how you talk to the operator* — like a human, not like a terminal.

## Layout

- `engine/` — runtime + decision + trust core
- `configs/` — per-funnel JSON (validated against `configs/_schema.json`)
- `tests/` — node `.mjs` suites (the safety net — keep green)
- `docs/adr/` — **every material decision is recorded here as an ADR**
- `docs/` — architecture, roadmap, competitive analysis, guides, standards
- `themes/`, `styles/`, `templates/`, `integrations/`, `analytics/`
- *(coming, Stage 1–2)* `authoring/` — URL ingestion + AI funnel generation

## Agreed product direction

`docs/PRODUCT_DECISIONS.md` is the **binding** record of product-shape decisions agreed
with the operator (inputs = URL-first "draft→refine"; output = hosted / **embed** /
single-file; lead sinks = Sheets-via-AppsScript + a universal **webhook**; integrate with
GHL/CRMs, never compete). Read it before shaping Stage 2/3; don't silently deviate.

`docs/UX_INTERFACE_DECISION.md` is the **binding** interface standard (Studio + respondent
funnel), derived from a UX teardown of 12 competitors and approved by the operator: **one
magic input → value in seconds → signup deferred**, a default surface that never gets
cluttered (advanced hidden), one-question respondent flow (progress from ~15%, 3–5 steps,
email before result), a decisive result (one pick + 2–3 grounded reasons + one CTA), and a
hard **no** to silent caps that disable live funnels and to manual per-product weighting.
Read it before building any UI; don't silently deviate.

## Working rules (non-negotiable)

1. **Document before you decide.** Any material choice gets an ADR in `docs/adr/`
   (context → options researched → decision → consequences) *before/with* the change.
   Research the best scenario first — do not guess.
2. **Keep tests green.** Nothing merges that turns a suite red. Extend the suites as you
   add behavior.
3. **No fabrication, ever.** A recommendation renders only if its reason resolves from
   the user's answers; every outcome maps to a real product with a real URL. The trust
   gate (`engine/trustValidate.js`) enforces no dead-ends and no unmeasured claims —
   never weaken it to make something pass; fix the funnel.
4. **Honest failure.** Lead delivery, analytics, ingestion: never report success you
   can't confirm. Surface the real state.

## MANDATORY DESIGN STANDARD

Before designing any funnel/recommendation/diagnostic, read and apply
`docs/standards/decision-funnel-design-standard-v1.md` (the 12 rules). Core law:
**Results First, Questions Last.** To build one, follow
`docs/standards/funnel-engine-reference-v1.md`; `configs/pm-certification-advisor.json`
is the reference bar (deterministic decision, signal-gated explanation, passing trust
gate, browser-verified).

**No bland funnels (binding).** Every funnel — AI-authored or hand-built — must pass
`docs/standards/funnel-quality-anti-bland-standard-v1.md`: no mirror/exposed question
(ask facts, derive the product), no single-question dominance (>40%), no unjustified
question, no unjustified result. This is an **automated** gate the authoring layer runs
alongside `trustValidate` — note the runtime trust gate catches a *dead* question but
not a *mirror* question, so the anti-bland gate must add that check. Never weaken it to
pass; fix the funnel.
