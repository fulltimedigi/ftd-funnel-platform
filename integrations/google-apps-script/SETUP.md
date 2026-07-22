# Apps Script Backend — Setup (leads + events + errors)

Stores funnel **leads, analytics events, and error reports** in one Google Sheet,
with **one tab-trio per funnel** (per-funnel isolation, ADR-0012). No server to
run. ~10 minutes.

Each `funnelId` gets its own tabs, auto-created on first write:
`<funnelId> Leads` · `<funnelId> Events` · `<funnelId> Errors`. Data from
different funnels never mixes, and adding a client is just a new config pointing
at the same `/exec` URL.

## 1. Create the Sheet
1. Go to https://sheets.google.com → blank spreadsheet.
2. Name it (e.g. "FullTimeDigi Funnels"). All tabs are created automatically on
   the first submission of each type.

## 2. Add the script
1. In the Sheet: **Extensions → Apps Script**.
2. Delete the default code, paste the contents of `Code.gs` from this folder.
3. Save.

## 3. Deploy as a Web App
1. **Deploy → New deployment**.
2. Type: **Web app**.
3. **Execute as:** Me.
4. **Who has access:** **Anyone**.
5. Deploy, authorize when prompted, and **copy the Web app URL** — it looks like:
   `https://script.google.com/macros/s/AKfyc.../exec`

## 4. Wire it into the funnel
1. Open the funnel config (e.g. `configs/freelancex.json`).
2. Set `analytics.sheetsEndpoint` to the `/exec` URL you copied.
3. Re-deploy the static site (or just reload locally).

## 5. Test
1. Run the funnel, complete it, submit a lead.
2. Refresh the Google Sheet → a `<funnelId> Leads` tab with your row appears; if
   analytics is enabled, a `<funnelId> Events` tab fills as you use the funnel.
3. Optional: open the `/exec` URL in a browser — the health check returns
   `{ "ok": true, "version": "2.0.0", … }` (this is `doGet`).

## Notes
- **Re-deploy after every script edit:** Deploy → Manage deployments → edit → New version. Just saving is not enough.
- **Upsert by email:** re-submitting the same email updates that funnel's row instead of duplicating (O(1) via a cached email→row index).
- **Routing:** the POST body's `type` selects the tab — `lead` → Leads (upsert),
  `event` → Events (append), `error` → Errors (append). `funnelId` is sanitized
  (alnum, `-`, `_`) before it names a tab; a bad id is rejected and writes nothing.
- **CORS / confirmation:** Apps Script doesn't return CORS headers, so the browser
  can't read the response. The funnel posts in `no-cors` mode and treats a sent
  request as success; it also keeps a localStorage audit + retry outbox (ADR-0006).
  If rows aren't appearing: re-check the URL, confirm access is "Anyone", and
  re-deploy a new version.
- Fine for launch volume. A CRM/webhook sink is a later-phase item.

## Columns written
- **`<funnelId> Leads`:** Timestamp · Funnel ID · Name · Email · Phone · Primary
  Archetype · Primary Name · Secondary Archetype · Flags · Scores (JSON) · Answers
  (JSON) · Result Layout · Recommended · Decision Rule · Source
- **`<funnelId> Events`:** Timestamp · Funnel ID · Event · Payload (JSON)
- **`<funnelId> Errors`:** Timestamp · Funnel ID · Level · Message · URL · User
  Agent · Context (JSON)
