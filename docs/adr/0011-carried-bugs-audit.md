# ADR-0011 — Close the four "carried bugs": three were production-only, one is deploy config

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

Stage 0 (ADR-0003) tracked four bugs to fix during the merge, all observed in the
**production** engine (`ftd-diagnostic-engine`):

1. `#funnel` vs `#ftd-app` mount-selector restart dead-end.
2. the `new-client.mjs` scaffolder writing an invalid `scoring.mode: "track-based"`.
3. `luxury-gold-light` in the theme enum but the CSS file absent.
4. a CSP that omits `googletagmanager.com`, blocking the GA4 sink.

The blend strategy (ADR-0003) is "start from v0, port the production runtime in module by
module." Crucially, the buggy production artifacts (its `index.js` boot, its scaffolder)
were **not** ported. So before "fixing" anything, each bug had to be checked against *this*
tree — fabricating a fix for a bug that isn't here would be dishonest and would add
misleading code.

## Audit (what's actually true in this repo)

1. **Mount-selector restart — NOT PRESENT.** This engine's `createFunnel(config, mountEl)`
   captures `mountEl` in closure; `restart()` → `renderHero()` → `mount(mountEl, …)`. There
   is no selector re-query and no `#funnel`/`#ftd-app` split. The production bug came from
   its boot code, which we did not port.
2. **`track-based` scoring mode — NOT PRESENT, and now structurally impossible.** No
   scaffolder exists here yet, and the string appears nowhere. The executable schema
   (ADR-0009) constrains `scoring.mode` to
   `sum-band | dominant | weighted-multi | decision-table`, so a future scaffolder cannot
   smuggle `track-based` past boot validation.
3. **`luxury-gold-light` theme — PRESENT.** `themes/luxury-gold-light.css` exists and is a
   complete token set; `asq-perfume` uses it and the engine's `loadTheme` injects it. The
   missing-file bug was production-only.
4. **GA4 CSP — no in-repo CSP exists.** The example shells set **no** CSP, so nothing
   blocks GA4 today. The real risk is a *deployed* CSP that omits the GA4 origins — a
   documentation/deploy-config matter, not an engine defect.

## Decision

Do **not** invent code fixes for bugs that aren't in this tree. Instead:

- **Lock the three "absent" bugs with guard tests** (`tests/carriedBugs.test.mjs`) so a
  regression is caught immediately:
  - restart re-renders into the *original* mount element, clears state, and the funnel is
    reusable afterwards;
  - `validateConfig` rejects `scoring.mode: "track-based"` (and any invalid mode);
  - every shipped config's declared `theme` has a real `themes/<name>.css` file.
- **Fix the GA4 CSP where it lives — the deploy docs.** `docs/DEPLOY.md` now ships a
  concrete `Content-Security-Policy` that allows the GA4 origins
  (`googletagmanager.com` in `script-src`; `google-analytics.com` +
  `region1.google-analytics.com` + `googletagmanager.com` in `connect-src`), plus the
  Apps Script endpoints, Google Fonts (needed by `luxury-gold-light`), and inline styles
  the engine emits — with a per-directive rationale and a note to add specific origins
  rather than widening to `*`.

## Consequences

- The Stage-0 "carried bugs" line is honestly closed: three verified absent and now
  regression-guarded; one addressed in the deploy configuration it actually concerns.
- No misleading "fix" code was added for non-existent defects (rule 4 — surface the real
  state).
- When the authoring layer's scaffolder is built (Stage 2–3), boot-time schema validation
  already blocks the `track-based` class of error; the CSP snippet is ready for the
  hosted platform.
- Stage 0 (unified engine) is complete: one engine with v0's rigor and production's
  delivery strengths, all suites green, no known bugs.
