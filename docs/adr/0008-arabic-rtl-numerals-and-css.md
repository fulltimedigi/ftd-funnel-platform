# ADR-0008 — Real Arabic RTL: numerals, LTR-forced inputs, and a working rtl.css

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

Stage 0 (ADR-0003) ports the production engine's **i18n-rtl** in to replace v0's stubs.
Fourth port, after error-monitor (0005), lead outbox (0006), and analytics (0007).

Arabic RTL is first-class for this product (`CLAUDE.md`, `configs/_schema.json`:
`lang` default `"ar"`). From the v0 seed it was unimplemented:

- `engine/i18n-rtl.js` — a stub whose only export, `toArabicNumerals`, **throws**.
- `styles/rtl.css` — a **stub** ("TODO: RTL corrections") with no rules.
- Engine-generated numbers were Western: `progress.js` rendered `"1 / 6"` (its own comment
  said Arabic conversion "lands with engine/i18n-rtl.js in a later phase" — **this phase**),
  and `resultRenderer` rendered `"64%"` / raw score values in Western digits.
- The example HTML shells set `<html dir="rtl">` and load `base.css`, but `base.css` has
  **no** RTL or email/phone handling, and the shells **do not load `rtl.css`** at all —
  so the critical LTR-email/phone rule existed only as an inline attribute, with no CSS
  backstop.

Per ADR-0003 the production i18n-rtl is the winner. But its `rtl.css` targets the
**production** class names (`.option-card`, `.field-label`, …), whereas this engine
renders **`ftd-`-prefixed** classes — so a verbatim copy would style nothing.

## Options considered

1. **Copy production's `i18n-rtl.js` + `rtl.css` verbatim.** Rejected: the JS reads
   `document`/`querySelectorAll` unguarded (throws under the Node test host), and the CSS
   selectors don't match this engine's DOM — it would be decorative, not functional.
2. **Ship only the numeral helper; leave wiring + CSS for later.** Rejected: leaves the
   headline feature (Arabic numerals on screen) and the critical LTR-input CSS unwired —
   a half-measure.
3. **Port the full helper set Node-safe, wire numerals through the render path, write a
   real `rtl.css` against this engine's actual classes, and load it in the shells.**
   Chosen.

## Decision

**Option 3.**

- **`engine/i18n-rtl.js`** — full port: `toArabicNumerals`, `isRTL`, `localizeNum`,
  `formatStepCounter`, `formatPercent`, `formatBlend`, `applyDocumentLocale`,
  `applyLTRInputs`, `textAlign`, `flexRow`, `sanitizeText`, `fillTemplate`. The two
  DOM-touching helpers guard for a missing/unqueryable `document`, so they are Node-safe
  no-ops (never throw). Pure helpers are inherently Node-safe.
- **Wiring (gated on `isRTL(config.lang)`; default `ar`):**
  - Progress step counter → `formatStepCounter` (`"١ / ٦"`). `lang` threaded
    `index.js → questionRenderer → progress.js`.
  - Result blend line → `formatPercent`; score-bar values → `localizeNum`
    (`resultRenderer`, both `tracks` and `commerce` layouts, reading `config.lang`).
- **`styles/rtl.css`** — rewritten against this engine's real `ftd-` classes: the
  **critical** LTR lock on email/phone inputs (CSS backstop to the inline attribute),
  `plaintext`/`embed` bidi for numerals and mixed Arabic/Latin (blend, bar values,
  secondary Latin names, prices), and RTL flow fixes (chips, bar/progress rows, option
  text, label/detail alignment). Loaded after `base.css` in all four example shells.

Because non-`ar` funnels fall back to Western numerals, and the only test asserting the
old `"1 / 6"` counter was updated to `"١ / ٦"` (the intended behaviour this phase
delivers — not a weakened assertion), all suites stay green. New `tests/i18n.test.mjs`
covers the pure helpers, host-safety of the DOM helpers, and the numeral wiring
end-to-end.

## Consequences

- Arabic funnels now display Arabic-Indic numerals throughout the engine-generated UI,
  while email/phone stay LTR and legible — with a CSS backstop, not just JS.
- `rtl.css` actually matches the DOM, so it is functional rather than decorative; the
  shells load it.
- The helper set (`applyDocumentLocale`, `formatBlend`, `sanitizeText`, `fillTemplate`,
  `flexRow`, `textAlign`) is available for future layouts (e.g. the `personas` result
  layout) without re-deriving RTL logic.
- Non-RTL languages are supported by the same code path (Western digits), so the engine is
  not Arabic-only even though Arabic is the default.
