# ADR-0005 — Port the production error-monitor (Node-safe, PII-masked)

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

Stage 0 (ADR-0003) merges the production engine (`ftd-diagnostic-engine`) into the
v0-seeded platform module by module, keeping `npm test` green at every step. This is the
first port: the **error monitor**.

v0 ships **no error monitoring at all**. The production engine has a mature one
(`engine/error-monitor.js`): structured levels (`fatal`/`error`/`warn`/`info`), an
offline-first `localStorage` ring buffer (50 entries per funnel), best-effort
fire-and-forget remote reporting to the Apps Script endpoint, global handlers for
uncaught errors and unhandled rejections, and — most importantly — **PII masking**
(emails, phones, names are masked before anything is stored or sent). Per ADR-0003 the
production error-monitor is the winner for this module.

The blocker is that the production module was written for the **browser only**. It
touches host globals at module load / init time that do not exist under Node, where the
test suites run:

- `_installGlobalHandlers()` calls `window.addEventListener(...)` **unguarded** — a bare
  `ReferenceError: window is not defined` in Node, thrown from `initMonitor()`. This is
  the one hard failure: it would crash any test that boots the monitor.
- `localStorage` reads/writes are **already** wrapped in `try/catch` and degrade to
  no-ops (the module's contract is "must never throw"), so they are Node-safe as-is.
- `window.location.href` / `navigator.userAgent` are **already** read through
  `_safeGet()` (try/catch with a fallback), so they are Node-safe as-is.
- `_reportRemote()` / `_drainQueue()` use `fetch`, but only when a remote endpoint was
  supplied to `initMonitor()`; tests supply none, so no network is touched.

## Options considered

1. **Port as-is and shim `window` in the test harness.** Rejected: it hides a real
   defect — the shipped runtime would still throw the moment it is imported anywhere
   without a DOM (SSR, a Node-side pre-render, a future authoring-layer import). The
   module's own contract says it must *never* throw; a host-global guard is the correct
   fix, not a test-only shim.
2. **Rewrite the module against an injected host abstraction.** Rejected for now: larger
   surface, no behavioural gain over a targeted guard, and it would diverge from the
   production source we are trying to converge on.
3. **Port with minimal host-global guards so the module is genuinely safe in any host
   (browser or Node), then cover it with a Node test suite.** Chosen.

## Decision

**Option 3.** Copy `engine/error-monitor.js` into the platform with the smallest set of
guards that make it host-agnostic, preserving the production behaviour and API exactly:

- `_installGlobalHandlers()` returns early unless `window.addEventListener` is a real
  function. In Node it installs nothing (correct — there are no uncaught-error events to
  catch); in the browser it behaves exactly as before.
- `_reportRemote()` / `_drainQueue()` return early unless `fetch` is a function, so a
  host without `fetch` degrades to "stored locally, not sent" instead of throwing —
  honest failure (rule 4), not a silent success.
- Everything else (the `localStorage` ring buffer, `_safeGet`-wrapped host reads, PII
  masking, level routing) is carried over unchanged.

Add a Node test suite (`tests/errormonitor.test.mjs`) and wire it into `npm test`. It
asserts the module never throws (pre-init, post-init, and when storage itself throws),
that the ring buffer stores/trims/clears, and — the reason this module exists — that PII
is masked (email → `***@domain`, phone → last 4 digits, `name` → `***`, one level of
nested objects sanitised).

This port does **not** yet wire the monitor into `engine/index.js` boot. ADR-0003 calls
for an "error-monitor first" boot sequence adapted to v0's decision core; that touches
the boot path and two config gates, so it is a separate step with its own test changes.
This ADR lands the module + its safety net so that boot integration builds on a covered,
Node-safe foundation.

## Consequences

- The platform now has PII-masked error monitoring available to import; v0's gap is
  closed.
- The module is genuinely host-agnostic: it can be imported in Node (tests, SSR, the
  future authoring layer) without a DOM shim and without throwing.
- One new test suite (15 → total) keeps this behaviour from regressing as boot
  integration and later ports land.
- Follow-up (tracked, ADR-0003): wire `initMonitor()` into `index.js` boot before the
  config gates, and route caught module failures through `error()`.
