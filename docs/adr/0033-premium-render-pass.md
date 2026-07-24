# ADR-0033 — Premium render pass (look matches the brain)

Status: Accepted · 2026-07-24

## Context

The decision engine is proven (oudfactory: 50/50 reachable, gates green), but the funnel
*looked* generic next to the operator's hand-built reference (oud-factory.netlify.app):
image-rich product cards, the store logo, a warm bespoke palette. Verified root causes:

1. **Images were captured but never surfaced.** `authoring/ingest/*` stores `image` per
   product, but `buildConfig` only used it for scoring — `recommendations.primary` carried
   `{name, url, price, becauseTemplate}`, no image. Nothing to render.
2. **Brand vars targeted the wrong CSS variables.** `brandToThemeVars` emitted
   `--brand`/`--cta-bg`/`--ink`, but `styles/base.css` reads `--primary`/`--accent`/
   `--surface`/… — so the palette barely connected, and the extracted accent collapsed to
   one near-black (`#1c1d1d` everywhere) — a dull dark wash, and the logo was never shown.
3. The default theme was **dark** (`platform-clean`) and pulled a **Google font** the new
   strict CSP (ADR-0032) blocks.

## Decisions

1. **Carry the real image through.** `buildConfig` adds `image: p.image || ""` to every
   `primary` and every nearest-alternate (`contextual`) and to the archetype. It flows
   untouched through `buildRecommendations` (spread). Only a real catalog image is ever
   used; a product without one carries `""` → the renderer shows a **tasteful placeholder**,
   never a fabricated image.
2. **Premium product card.** `resultRenderer` renders `image + name + price + grounded
   reason + one CTA` as a hero card, a grounded "✦ الأنسب لك" match badge, and a compact
   "قد يناسبك أيضاً" strip of real alternate thumbnails — decisive (one clear #1, one CTA)
   per UX_INTERFACE_DECISION. `engine/dom.js` gains `safeSrc` (http/https/data/relative
   only) so a poisoned config can't inject a hostile `src`.
3. **Real brand identity.** `extractBrand` derives a **warm, saturated, contrasting**
   accent (a real brand hex when one pops, else a premium gold `#c8a24a`) and never a
   near-black wash; the store **logo** renders in the hero and result header.
   `brandToThemeVars` now emits the **exact token vocabulary** `base.css` reads
   (`--primary/--primary-2/--on-primary/--accent/--accent-soft/--bg/--surface/--text/…`),
   with derived shades for a coherent, high-contrast set.
4. **Self-contained premium theme.** New `themes/platform-premium.css` (warm cream, deep
   ink, gold accents, editorial spacing) is the default for authored funnels — **no
   external fonts** (CSP-safe): a refined system serif-display + Arabic-friendly body.

## Consequences

- **No fabrication:** images, prices, and reasons come only from the real catalog; a
  missing image is an honest placeholder. **Gates untouched** (trust + anti-bland +
  richness) — this is render-only; the decision core and coverage are unchanged and stay
  deterministic.
- The brand palette now genuinely drives the funnel (right variables) and always yields a
  warm, contrasting identity instead of a dark wash; the logo shows.
- Tests: `premium.render` proves the recommendation carries a real image (and `""` →
  placeholder) and `safeSrc` blocks hostile `src`; `brand` updated to the real vocabulary
  + a "drab site still yields a warm accent" guard. All suites green.
- CSP already allows `img-src https: data:`, so real product images and the logo load with
  no policy change. Preview only; live site untouched.
