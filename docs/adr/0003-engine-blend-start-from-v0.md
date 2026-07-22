# ADR-0003 — Blend strategy: start from v0, merge the production runtime in

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

We have two sibling funnel engines, both zero-build vanilla-ES-module, config-driven:

- **`fulltimedigi-engine-v0`** — the "reference" engine. Rigorous **decision core**
  (decision-table as data: `signals` → `derivedSignals` → `decisionTable`), a
  **signal-gated explanation** layer (a reason renders only if the user's answers
  support it), and — critically — an **executable trust gate** (`trustValidate.js`)
  that sweeps the entire answer space for dead-ends and lints copy for
  "fake-intelligence" claims. It ships **14 test suites (176 assertions), all green,
  CI-enforced.** Weaknesses: analytics/i18n/GA4 modules are unimplemented stubs, lead
  delivery is unproven, RTL css is a stub.

- **`ftd-diagnostic-engine`** — the later "production" engine. Mature **runtime &
  delivery**: a real lead-capture loop (offline queue → POST → honest failure), an
  **error monitor with PII masking**, a **per-funnel Google-Sheets backend** with
  email-dedupe upsert, GA4 sink, security headers/CSP, a `commercial_anchor` (real
  product) requirement, and a `new-client.mjs` scaffolder. Weaknesses: **no test
  suite exists** (the referenced `tests/` dir is absent), schema↔validator drift, a
  `#funnel`/`#ftd-app` mount-selector restart bug, an invalid `track-based` scoring
  mode in the scaffolder, a missing `luxury-gold-light` theme file, and a CSP that
  blocks GA4.

Basis: two full code deep-dives + a 9-platform competitor teardown (see
`docs/COMPETITIVE_ANALYSIS.md`).

## Options considered

1. **Start from production, add tests later.** Risk: we'd build on an unverified base
   with known latent bugs and no safety net; every later change could silently break
   determinism with nothing to catch it.
2. **Merge both blindly into a fresh tree, then fix.** Risk: reconciling imports across
   two runtimes at once, with no green baseline, is error-prone and unverifiable.
3. **Start from v0 (green tests) and merge the production runtime in module by module,
   keeping `npm test` green at every step.** Safest: we always have a working,
   verified baseline; each production improvement is proven not to break the core.

## Decision

**Option 3.** Seed the platform from `fulltimedigi-engine-v0` (verified: 14 suites
green here), then port the production engine's runtime/delivery strengths in
incrementally, test-green-gated. Module-by-module intent:

| Module | Winner | Rationale |
|--------|--------|-----------|
| `scoring` (4 modes incl. decision-table) | **v0** | decision-table is the rigorous, auditable model; production only has 3 modes |
| `signals` / `decide` / `recommend` | **v0** | decision-as-data + signal-gated explanation; production has no equivalent |
| `trustValidate` (totality sweep + fake-intelligence linter) | **v0** | the single most defensible asset; merge production's false-promise phrase list into it |
| config schema → **make it executable** | **both** | v0's schema is the contract; adopt production's `config-validator` logic and actually run schema validation at boot (both engines left the schema decorative — fix that) |
| `index.js` boot (error-monitor first, two gates) | **production** | more mature boot sequence; adapt to v0's decision core |
| `state.js` (phase machine, sessionId, resume) | **production** | richer persisted state |
| `resultRenderer` (personas/commerce/tracks) | **production** | 3 real layouts; wire to v0 decision output |
| `leadCapture` (queue → POST → honest failure, rich payload) | **production** | v0's lead path is thinner |
| `error-monitor` (PII masking) | **production** | v0 has none |
| `analytics` + `sheets-sink` + `ga4-sink` | **production** | v0's are throwing stubs |
| `i18n-rtl` (numerals, LTR-forcing, template fill) | **production** | v0's throws "not implemented" |
| themes / `base.css` / `_tokens.css` | **production** | more complete token contract |
| tools (`new-client`, `validate-config` running both gates) | **production** | with the `track-based` bug fixed |
| backend `Code.gs` (per-funnel isolation, upsert) | **production** | v0's is simpler |
| **test suites** | **v0** | production has none — v0's 14 suites are the safety net; extend as we merge |

## Bugs to fix during the merge (tracked so none is forgotten)

From `ftd-diagnostic-engine`:
- Missing test suite → **ported from v0** (this is the whole point of starting there).
- Schema ↔ validator drift (archetype count 4–8 vs 2–10) → single executable source.
- `#funnel` vs `#ftd-app` mount-selector restart dead-end.
- `new-client.mjs` writes invalid `scoring.mode: "track-based"`.
- `luxury-gold-light` in the enum but the CSS file is absent.
- CSP omits `googletagmanager.com`, blocking the GA4 sink.

From `fulltimedigi-engine-v0`:
- Analytics event bus / GA4 sink / i18n numerals are stubs → replaced by production's.
- Lead delivery never proven end-to-end → production's loop + a real endpoint test.
- `styles/rtl.css` stub → production's implemented RTL.
- `personas` result layout falls back to `tracks` → build it from production's.
- Stale `PROJECT_TREE.txt` → removed.

## Consequences

- We always have a green, deterministic baseline; the merge is verifiable at each step.
- Some v0 module APIs will be adapted as production modules land; ADRs will note any
  interface change that matters.
- End state: one engine with v0's *rigor* and production's *delivery*, and neither's
  bugs — the foundation the AI authoring layer (Stage 1–2) builds on.
