# ADR-0007 — Port the analytics bus + working Sheets/GA4 sinks, wire the funnel lifecycle

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

Stage 0 (ADR-0003) ports the production engine's **working analytics** in to replace
v0's stubs. Third port, after error-monitor (0005) and the lead outbox (0006).

"Analytics must exist from day one — without it we can't prove ROI, and ROI is the sale"
(`docs/EVENTS.md`). The platform ships a **fixed event vocabulary** (10 events) but, from
the v0 seed, nothing implements or emits it:

- `engine/analytics.js` — a stub whose `emit()` / `registerSink()` **throw
  "not implemented"**.
- `analytics/ga4-sink.js` — a stub whose `createGa4Sink()` **throws**.
- `engine/index.js` — emits **no events at all** (header even says "NO analytics events").

Per ADR-0003 the production analytics (bus + Sheets + GA4) is the winner for this module.
A filename subtlety: the platform's `analytics/sheets-sink.js` is the **lead transport**
(`createSheetsSink(endpoint).submit`, depended on by the lead loop and the ADR-0006
outbox), whereas the production file of the same name is an **event sink**
(`registerSink(endpoint)`). They are different responsibilities that happen to share the
Apps Script `/exec` endpoint.

## Options considered

1. **Overwrite `analytics/sheets-sink.js` with the production event sink.** Rejected: it
   would delete the lead transport the lead loop + outbox depend on (breaking green
   suites) and conflate two responsibilities.
2. **Port the bus + GA4 only; leave event-to-Sheets logging for later.** Rejected: the
   Sheets tab is the zero-cost default analytics destination; without it the default
   funnel has no analytics sink at all.
3. **Port the bus + GA4 sink, and *add* an event-sink role to the existing
   `sheets-sink.js` alongside the untouched lead transport; then wire the lifecycle
   emits into `index.js`.** Chosen.

## Decision

**Option 3.**

- **`engine/analytics.js`** — replace the throwing stub with the production bus:
  `initAnalytics`, `registerSink`, `emit`, and the 10 typed emitters. It is already
  Node-safe (no host globals; `emit` catches every sink error — analytics never throws or
  blocks the funnel). Added `resetAnalytics()` (drop sinks + id) for test isolation and
  clean re-init; harmless in production.
- **`analytics/ga4-sink.js`** — replace the throwing stub with the production GA4 sink
  (`registerSink(measurementId)` → bus). Host-safe: with no `window.gtag` (Node, or GA4
  not yet loaded / blocked by CSP) it skips silently. GA4 param mapping and 40-char
  sanitisation preserved.
- **`analytics/sheets-sink.js`** — **add** `registerSink(endpoint)` (event sink → bus,
  best-effort `no-cors` POST of `{type:'event', …}` to the Events tab) **beside** the
  unchanged `createSheetsSink` lead transport. Guarded so a host without `fetch` degrades
  to "not sent" instead of throwing.
- **`engine/index.js`** — `initAnalytics(config.id)`, register the sinks named in
  `config.analytics.sinks` (best-effort), and emit the fixed vocabulary across the
  lifecycle: `quiz_start` (start), `question_answered` (select), `question_back` (back),
  `lead_shown` / `lead_submitted(success)` / `lead_skipped`, `result_shown` +
  `funnel_complete(leadCaptured)`, `restart`, and `cta_clicked` via a **guarded**
  post-render hook on the result CTAs (browser-only; the Node DOM shim has no
  `querySelectorAll`, so it is skipped there and the funnel behaves identically).

Because existing suites inject their own transport and set **no** `analytics.sinks`, no
sink registers, so every `emit()` is a no-op and all 16 suites stay behaviourally
unchanged. New `tests/analytics.test.mjs` registers a capture sink to assert the bus, the
sink mappings, never-throws-on-sink-failure, host-safety, and the **end-to-end event
sequence** a driven funnel produces.

## Consequences

- The funnel emits a complete, documented event stream to zero-cost Sheets and/or GA4 —
  the metrics in `docs/EVENTS.md` (per-step drop-off, completion, lead-capture rate,
  archetype distribution, CTA CTR) become measurable.
- Analytics can never break the funnel: registration is best-effort, `emit` swallows sink
  errors, and both sinks are host-safe (no `fetch`/`gtag` → silent skip, honest non-send).
- `sheets-sink.js` now has two explicit, non-colliding roles (lead transport vs event
  sink), documented in-file.
- Follow-up (tracked, ADR-0003): the GA4 CSP allow-list fix (so the GA4 script can load in
  production) is a separate bug-fix item; this ADR makes the sink correct and safe for
  when it does.
