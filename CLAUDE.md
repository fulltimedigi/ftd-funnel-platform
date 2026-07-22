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

## Layout

- `engine/` — runtime + decision + trust core
- `configs/` — per-funnel JSON (validated against `configs/_schema.json`)
- `tests/` — node `.mjs` suites (the safety net — keep green)
- `docs/adr/` — **every material decision is recorded here as an ADR**
- `docs/` — architecture, roadmap, competitive analysis, guides, standards
- `themes/`, `styles/`, `templates/`, `integrations/`, `analytics/`
- *(coming, Stage 1–2)* `authoring/` — URL ingestion + AI funnel generation

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
`docs/standards/decision-funnel-design-standard-v1.md`. Core law: **Results First,
Questions Last.** To build one, follow `docs/standards/funnel-engine-reference-v1.md`;
`configs/pm-certification-advisor.json` is the reference bar (deterministic decision,
signal-gated explanation, passing trust gate, browser-verified).
