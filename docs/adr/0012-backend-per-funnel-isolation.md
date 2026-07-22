# ADR-0012 — Merge the production backend `Code.gs` (per-funnel isolation, adapted to our payloads)

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

Final Stage-0 item (ADR-0003): "merge production's backend `Code.gs` (per-funnel
isolation)". The backend is the Apps Script web app that receives the funnel's POSTs and
writes them to a Google Sheet.

State from the v0 seed: our `Code.gs` handled **leads only**, in a **single shared
`Leads` tab**, with no `funnelId` in the row and no routing. Two problems had grown as we
ported the front end:

- The analytics **event** sink (ADR-0007) and the error-monitor **remote report**
  (ADR-0005) POST `{type:'event'}` / `{type:'error'}`, which the old backend would have
  mangled into malformed lead rows.
- No **per-funnel isolation**: every client's leads landed in one tab, so lookups scanned
  everyone's rows and data couldn't be exported per client.

The production `Code.gs` already solves this (per-funnel tab trio, type routing, cached
email upsert, funnelId sanitization) — but its **field mapping does not match our
engine's real payloads**: it reads `source.url`/`source.utmSource` (ours `source` is a
plain string), error fields `ts`/`msg`/`stack` and a browser global `navigator` (ours are
`timestamp`/`message`/`userAgent` on the entry, and `navigator` would throw), and lead
columns we don't emit (`sessionId`, `leadSkipped`).

## Options considered

1. **Copy production `Code.gs` verbatim.** Rejected: it would write blank/mismatched
   columns for our payloads, its `handleError` references an undefined `navigator`, and it
   expects fields our engine never sends — silent data loss dressed as success.
2. **Extend our lead-only backend with ad-hoc event/error branches.** Rejected: reinvents
   the per-funnel isolation and cached upsert the production one already models well.
3. **Adopt the production architecture, re-mapped field-by-field to our real payloads,
   and cover it with a Node test using a fake Apps Script environment.** Chosen.

## Decision

**Option 3.** Rewrite `integrations/google-apps-script/Code.gs`:

- **Per-funnel isolation:** `doPost` routes by `type` to `<funnelId> Leads` (upsert by
  lowercased email, via a CacheService email→row index), `<funnelId> Events` (append), or
  `<funnelId> Errors` (append). `funnelId` is sanitized (`^[A-Za-z0-9_-]+$`) before it
  names a tab; a bad id writes nothing. `doGet` is a health check.
- **Fields mapped to *our* payloads:** lead columns match `buildLeadPayload`
  (incl. `primaryArchetypeName`, `resultLayout`, `recommended`, `decisionRule`, and
  `source` as a string); events match `sheets-sink` (`{event, payload}`); errors match
  `error-monitor` (`timestamp/level/message/url/userAgent/context`, single entry, with an
  `{errors:[…]}` batch tolerated). No dependence on a browser `navigator`.
- **Testable:** `tests/backend.test.mjs` loads the real `Code.gs` in a `node:vm` context
  with an in-memory `SpreadsheetApp`/`CacheService`/`ContentService`, and asserts routing,
  per-funnel tab creation, create-then-update upsert (no duplicate), cross-funnel
  isolation, event/error append, and honest rejection of a malicious/missing `funnelId`
  (no tab pollution). `SETUP.md` updated for the tab-trio and new columns.

## Consequences

- One `/exec` endpoint now correctly persists **leads, events, and errors**, isolated
  per funnel; onboarding a client is a new config, not new backend code.
- The backend agrees with what the engine actually sends — no silently blank columns, no
  `navigator` crash; email upsert prevents duplicate leads.
- Backend logic is now regression-covered in CI despite living in Apps Script, via the
  fake-GAS harness.
- **Stage 0 (Unified engine) is complete:** one engine with v0's rigor and production's
  delivery — error monitor, offline lead outbox, working analytics, Arabic RTL, executable
  schema, all three result layouts, no known bugs, and a per-funnel backend — with 22
  test suites green. Next: Stage 1 (catalog ingestion).
