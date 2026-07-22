# Apps Script Backend — Setup (Lead Loop)

Stores funnel leads in a Google Sheet. No server to run. ~10 minutes.

## 1. Create the Sheet
1. Go to https://sheets.google.com → blank spreadsheet.
2. Name it (e.g. "FreelanceX Leads"). The "Leads" tab is created automatically on the first submission.

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
2. Refresh the Google Sheet → a new row should appear in the **Leads** tab.

## Notes
- **Re-deploy after every script edit:** Deploy → Manage deployments → edit → New version. Just saving is not enough.
- **Upsert by email:** submitting the same email again updates that row instead of adding a duplicate.
- **CORS / confirmation:** Apps Script doesn't return CORS headers, so the browser
  can't read the response. The funnel posts in `no-cors` mode and treats a sent
  request as success; it also keeps a localStorage audit copy of every lead.
  If rows aren't appearing: re-check the URL, confirm access is "Anyone", and
  re-deploy a new version.
- This is fine for launch volume. A CRM/webhook sink and analytics-event
  forwarding are later-phase items.

## Columns written (Leads tab)
`التاريخ والوقت · الاسم · الإيميل · الجوال · المسار الأول · المسار الثاني · الـ Flags · النتائج (Scores) · الإجابات · المصدر`
