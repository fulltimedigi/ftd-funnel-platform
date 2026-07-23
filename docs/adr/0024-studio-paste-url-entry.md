# ADR-0024 — Stage 3B: the paste-URL entry screen (closing the journey)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Scope:** Stage 3B UI, the entry point before the review screen (ADR-0023). Closes the
  demonstrable journey **paste URL → generate → review → publish** (PRODUCT_DECISIONS §1).

## Context

The review screen (ADR-0023) starts from an already-generated draft. The missing front
door is **paste your store URL → get a funnel.** The one required input is the URL; the one
optional input worth asking is the **business goal** (§1). This screen collects them,
validates, runs generation, and hands the draft to review.

**The hard constraint (and why it shapes the design):** a browser **cannot** fetch and crawl
an arbitrary cross-origin site (CORS) — which is *exactly why* live generation belongs
**server-side** (ADR-0019/0022). So the entry screen cannot truly generate from a real
external URL in the browser today, and pretending it did would violate rule 4.

## Options researched

- **Fake/stub the generation for the demo.** Rejected — dishonest; the operator explicitly
  values never reporting success we can't confirm.
- **Show only an honest "server-side, coming in 3C" placeholder.** Honest but leaves the
  journey undemonstrable end-to-end.
- **Ship a same-origin SAMPLE store and run the REAL pipeline against it (chosen).** A
  synthetic, clearly-labelled demo catalog (`examples/sample-shop/`, mirroring the
  authoring test fixture — no real client data) served from our own origin lets the browser
  run the **genuine** ingest → author → trust + anti-bland chain and produce a **real**
  funnel. External URLs still fail **honestly** with the server-side explanation. Best of
  both: a real end-to-end demo *and* the truth about live generation.

## Decision

- **`platform/intake/intakeModel.js`** (pure, tested): `normalizeUrl` (bare host → https,
  lower-case host, reject non-http/hostless/junk) + `buildIntake({url, goal})` → a validated
  request or an honest `invalid-url`. The optional goal is captured and length-bounded.
- **`examples/sample-shop/index.html`**: a SYNTHETIC demo store exposing its catalog as
  JSON-LD `Product` nodes (the shape `authoring/ingest/jsonld.js` reads). Labelled
  "demo catalog — not a real store." Exists solely so the journey is demonstrable for real.
- **`platform/intake/start.html`** (RTL/Arabic entry screen): URL field + optional goal +
  an **authorization confirmation** (scope = authorized/own-client sites only, ADR-0013).
  On submit it runs the **real** `generateFunnelFromUrl` in the browser:
  - success → stash the config in `sessionStorage` and navigate to
    `review/review.html?draft=1`;
  - failure (e.g. a real external URL the browser can't read) → an **honest** message that
    live generation runs server-side (coming next), with a one-click **sample-store** path;
  - the surfaced engine reason is shown, never a fake success.
- **Draft hand-off:** `review.html?draft=1` and `funnel.html?draft=1` read the freshly
  generated config from same-origin `sessionStorage` (the review screen's preview iframe is
  same-origin, so it shares it) — so the review + **live preview** show the *real* draft,
  no round-trip to disk.

## Consequences

- The **whole product journey is real and demonstrable today**: paste (sample) → genuine
  generation (ingest+author+both gates) → review with a live preview → a copy-pasteable
  embed — zero fabrication.
- The honesty boundary is explicit and correct: live crawling of real external sites is
  **server-side (3C)**; the screen says so and is already wired to swap the in-browser call
  for a server endpoint with no UI change.
- `examples/sample-shop/` is synthetic and self-labelled — it never pollutes real-client
  data (CLAUDE.md fixture rule respected).
