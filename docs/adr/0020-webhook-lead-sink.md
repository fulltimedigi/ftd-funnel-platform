# ADR-0020 — Universal Webhook lead sink + configurable lead transport

- **Status:** Accepted
- **Date:** 2026-07-23
- **Scope:** Stage 3A, first delivery piece. Standing approval to build 3A.

## Context

`docs/PRODUCT_DECISIONS.md` §3: the funnel **sends** each lead to a **configurable
destination** with a **rich payload** (email + answers + recommended real product +
archetype + score). Default is Sheets-via-AppsScript (`analytics/sheets-sink.js`, a lead
transport with `createSheetsSink(url).submit(payload)`). The **universal Webhook sink** is
the 80/20 that unlocks **GHL, Zapier, Make, and most CRMs at once** (integrate, don't
compete). Today there is no webhook sink and only one lead destination is wired.

## Decision

- **`analytics/webhook-sink.js`** — `createWebhookSink(url).submit(payload)`, mirroring the
  Sheets sink's shape so it drops into the existing lead path:
  - POST the **full lead payload** as JSON. Unlike Apps Script, a real webhook (GHL/Zapier)
    usually returns CORS + a status, so we **read it and confirm honestly**: `res.ok` →
    `{ok:true, confirmed:true, status}`; a non-OK status → `{ok:false, status}`. On a CORS/
    network error, **fall back to a `no-cors` fire-and-forget** POST → `{ok:true,
    confirmed:false}` (sent, unconfirmable), and only a hard failure → `{ok:false,
    reason:"network"}`. Never fakes success (rule 4).
  - Keep a `localStorage` audit copy of every attempt (offline safety), like the Sheets sink.
  - A missing/placeholder URL → `{ok:false, reason:"no-endpoint"}` and **no network call**.
- **`engine/leadTransport.js`** — `createLeadTransport({sheetsEndpoint, webhookUrl})` fans a
  lead out to **every configured** destination and returns `{ok: someSucceeded, results}`.
  This makes the lead destination genuinely *configurable* (Sheets, Webhook, or both) with
  one honest result. It wraps under the existing offline **outbox** (ADR-0006), so a lead is
  still retried if all destinations fail.
- **Wire `engine/index.js`** to build the lead transport from the config
  (`analytics.sheetsEndpoint` and `leadForm.webhookUrl` / `analytics.webhookEndpoint`)
  instead of Sheets-only. Injected test transports are still used raw (all existing suites
  unchanged); with no destination configured the transport honestly reports `no-endpoint`
  (same as before).
- **Schema:** add optional `leadForm.webhookUrl` (and `analytics.webhookEndpoint`) — the
  schema is lenient, but declaring them documents the contract.

Pure/injected-`fetch`, fully offline-testable. The rich payload already exists
(`buildLeadPayload` in `index.js`: email, answers, scores, flags, `recommended`,
`primaryArchetype`, `decisionRule`, …) — the webhook simply carries it.

## Consequences

- One webhook makes every funnel instantly integrable with GHL/Zapier/Make/CRMs, carrying
  our differentiator (the answer profile + recommended product) for downstream routing.
- The lead destination is now configurable and multi-sink, with honest confirmation when the
  endpoint supports CORS and honest "sent, unconfirmed" when it doesn't — never a fake
  success — and still outbox-retried on failure.
- Foundation for 3A's packaging (embed/hosted/single-file): a published funnel just needs a
  `webhookUrl` in its config to feed the client's CRM.
