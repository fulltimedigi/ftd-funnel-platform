# ADR-0023 — Stage 3B: the Studio review screen

- **Status:** Accepted (first Studio UI slice)
- **Date:** 2026-07-23
- **Scope:** Stage 3B UI, over the platform core (ADR-0022). The first screen the
  client sees: **review the AI draft before publishing.** Accounts + server persistence
  are 3C.

## Context

The product flow (PRODUCT_DECISIONS §1) is **paste URL → auto-generate → review → refine
→ publish**. ADR-0022 built the deterministic core (generate/gate/refine/publish). The
first thing a non-technical client must see is a **review screen** that answers, in plain
terms: *"Here's the funnel we built for you, here's proof it's trustworthy, here's what
it will ask and recommend — publish it or tweak it."*

Two things the screen must show honestly:

1. **A live preview** — the *actual* funnel, not a mock. Reusing the hosted page
   (`embed/funnel.html`, ADR-0021) in an iframe means the preview is byte-for-byte what
   the visitor will get.
2. **The trust evidence** — the funnel already passed `trustValidate` + `antiBlandCheck`
   in generation, but the client must *see* it: both gates green, with counts, and — if a
   draft is **blocked** — the findings that explain *why*, never a hidden failure (rule 4).

## Options researched

- **Preview: re-render in-page vs iframe.** In-page booting would leak the funnel's CSS
  into the Studio chrome and vice-versa. **iframe reuse of `funnel.html`** gives the same
  isolation the embed already relies on and guarantees preview == production. Chosen.
- **Gate results: trust the generation payload vs recompute in the screen.** The screen
  **recomputes** `trustValidate`/`antiBlandCheck` from the config (they're pure ES modules,
  browser-safe) so the review is *self-verifying* — it can't show green over a stale/edited
  config. Cheap and honest.
- **Screen logic: in the HTML vs a pure model.** The decision logic (publishable? which
  blockers? the summary numbers) is extracted into a **pure `buildReviewModel()`** that is
  unit-tested; the HTML is a thin renderer. Same discipline as the rest of the codebase.

## Decision

- **`platform/review/reviewModel.js`** (pure, tested): given `{config, trust, bland,
  catalog, meta}` → a **review model**:
  - `ok` / `status` (`ready` | `blocked`),
  - `gates[]` — per gate `{id, label, ok, findingCount, findings, summary}` (Arabic labels),
  - `blockers[]` — plain-language reasons when blocked,
  - `summary` — brand, question count, result count, product count, the first question, and
    the list of recommended products (so the client sees *what it asks* and *what it
    recommends* at a glance).
- **`platform/review/review.html`** (RTL/Arabic UI): resolves `?funnel=<id>` / `?config=
  <url>` (same sanitized resolver as `funnel.html`), fetches the config, **recomputes both
  gates**, builds the review model, and renders: a header, two **gate cards** (green/red
  with findings), a **summary panel**, a **live preview iframe** (`funnel.html?config=…`),
  and a **publish panel** that produces the real artifact (hosted URL + the ADR-0021 embed
  one-liner via `platform/publish.js`) for the client to copy.
  - **Honesty:** the button *gets the embed code* (which it genuinely produces locally); it
    does **not** claim "saved to your account / hosted" — that lands with accounts +
    persistence in 3C. A blocked draft shows the findings and **hides publish**.
- **`tests/platform.review.test.mjs`** — asserts the model: green→ready, a failing gate→
  blocked with the finding surfaced, and correct summary numbers.

## Consequences

- The client gets a **trustworthy, self-verifying review** of the AI draft, with a preview
  that is exactly what visitors will see — the credibility moment of the product.
- Publish from the screen yields a **real, copy-pasteable** embed today (no fake backend);
  account-scoped hosting is a clean later swap (3C) behind the same button.
- The screen's logic is pure and tested; the browser page is a thin, verifiable shell.
