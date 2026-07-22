# ADR-0006 — Offline outbox for leads (never lose a lead, never fake success)

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

Stage 0 (ADR-0003) ports the production engine's **lead-capture loop** — described
there as "offline queue → POST → honest failure" — into the v0-seeded platform. This is
the second port (after the error-monitor, ADR-0005), and it is the **commercial core**:
if a lead is lost, the whole funnel produced nothing.

What the platform has today (from the v0 seed):

- `engine/leadCapture.js` — a clean, injectable lead form: it validates, calls an
  injected `onSubmit(values) → {ok}` transport, and on failure keeps the user on the
  form with an honest error (no silent success). Good.
- `analytics/sheets-sink.js` — the default transport. Because Apps Script web apps return
  no CORS headers, it POSTs `no-cors` (opaque response) and can only report `{ok:true,
  confirmed:false}` = "sent, not confirmable". It also appends every submitted payload to
  a permanent **audit log** in `localStorage` (`ftd:leads:<id>`).
- `engine/index.js` — wires the form to the transport: on `{ok:true}` it shows the
  result; on `{ok:false}` it leaves the user on the form.

**The gap.** There is no retry. If the network is down at the submit moment, the lead is
written to the audit log but **nothing ever tries to send it again** — it is silently
stranded on the visitor's device. The audit log cannot serve as a retry queue because it
is append-only and also contains already-sent leads; draining it would re-send
everything. So "offline queue → POST" is, in practice, missing.

The production `leadCapture.js` is not a clean drop-in: it is a single browser-coupled
module that mixes rendering, validation, HTTP (with a cors→no-cors retry), analytics, and
a `localStorage` queue, and it reads `window`/`document`/`requestAnimationFrame`
directly. Its own queue is optimistic-then-dequeue-on-success but is likewise **never
re-drained in a later session**, so it does not actually deliver stranded leads either.
Porting it wholesale would violate ADR-0004's clean, injected-transport architecture and
regress testability, without even closing the gap.

## Options considered

1. **Replace `leadCapture.js` with the production monolith.** Rejected: browser-coupled,
   not Node-testable, mixes concerns, and still has no real re-drain — it does not solve
   the actual problem and it loses the clean architecture.
2. **Make `sheets-sink.js`'s audit log double as a retry queue.** Rejected: the audit log
   is a permanent record of *all* attempts (including successes); retrying from it would
   re-send delivered leads on every load. Conflating "permanent log" with "not-yet-sent
   outbox" is the wrong model.
3. **Add a dedicated, transport-agnostic outbox module and a thin resilient wrapper.**
   Chosen. A new `engine/leadQueue.js` holds only *not-yet-confirmed-sent* leads, retries
   them, and removes exactly the ones the transport accepts — keeping the clean injected
   architecture and staying Node-safe and unit-testable.

## Decision

**Option 3.** Add `engine/leadQueue.js`:

- **`enqueueLead(payload, funnelId)`** — append to an outbox keyed
  `ftd_lead_outbox_<funnelId>` (ring buffer, 50 max), de-duplicated by
  `dedupeKey|timestamp` so the same submit is not queued twice.
- **`drainOutbox(transport, funnelId)`** — try to send every pending lead; **remove the
  ones the transport accepts (`res.ok === true`), keep the ones it rejects**. A transport
  that throws is treated as *not sent* (kept). Returns an honest summary
  `{sent, kept, total}` — never claims delivery it did not get.
- **`createResilientSink(transport, funnelId)`** — wraps any transport: on `submit` it
  enqueues first (so the lead can never be lost), sends, and removes the entry only on
  success. It exposes `drain()` (call at boot to flush a previous session's stranded
  leads) and, in a browser only (guarded exactly like the error-monitor, ADR-0005),
  re-drains on the `online` event when connectivity returns.

Wire it into `engine/index.js` **only for the default production sink**: when a test
injects `deps.submitLead`, that transport is used raw (so all 14 existing suites are
behaviourally unchanged); when the default Sheets sink is used, it is wrapped in
`createResilientSink` and `drain()` is called at funnel start.

**Honesty under `no-cors`.** We cannot read the Sheets response, so "sent" means
"sent, unconfirmable". The outbox removes a lead on `ok:true` (sent) rather than holding
it forever, because (a) the permanent audit log still records it and (b) the backend
`Code.gs` upserts by email (ADR-0003), so the rare opaque-but-failed case is absorbed by
dedupe on any future resend — whereas re-sending *every* lead on *every* load would spam
the sheet. We keep exactly what we *know* failed (the fetch threw / no endpoint) and
surface that state to the visitor — no fabricated success (rule 4).

Add `tests/leadqueue.test.mjs` and wire it into `npm test`.

## Consequences

- A lead stranded by a network drop is retried automatically on the next funnel load (and
  the moment the browser reports `online`), instead of being silently lost.
- The clean, injected-transport architecture (ADR-0004) is preserved; the outbox is a
  transport-agnostic layer, fully unit-tested in Node without a DOM.
- Two `localStorage` roles are now explicit and separate: the **audit log**
  (`ftd:leads:<id>`, permanent, every attempt) and the **outbox**
  (`ftd_lead_outbox_<id>`, transient, only not-yet-sent).
- Follow-up (tracked, ADR-0003): the richer production payload fields (blend proportion,
  UTM `source`) and the cors→no-cors transport retry can be folded into the sink later;
  they are independent of this delivery-resilience layer.
