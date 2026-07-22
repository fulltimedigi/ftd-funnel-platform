# Google Sheets Lead Capture — End-to-End Setup

Make funnel leads land in a real Google Sheet. ~10 minutes. Do the steps in order.

> Steps **4** (publish) and the authorization prompt happen inside **your** Google
> account — only you can click those. Step **6** gives a `curl` command that proves a
> real row was written.

---

## Step 1 — Create the Google Sheet

1. Go to <https://sheets.google.com> → **Blank spreadsheet**.
2. Rename it (top-left), e.g. `FullTimeDigi Leads`.
3. Leave it empty. The **`Leads`** tab and its header row are created automatically on
   the first lead (you do not need to add columns by hand).

---

## Step 2 — Open the Apps Script editor

1. In that Sheet: menu **Extensions → Apps Script**.
2. A new tab opens with a file `Code.gs` containing a default `myFunction`.

---

## Step 3 — Paste the backend code (`Code.gs`)

1. In the Apps Script editor, select **all** existing code and delete it.
2. Open this repo file and copy its full contents:
   `integrations/google-apps-script/Code.gs`
3. Paste it into the editor.
4. Click the **Save** icon (or ⌘/Ctrl+S).

This script:
- creates a tab named **`Leads`** on first write,
- **upserts by lowercased email** (same email updates its row; new email appends),
- returns `{"ok":true}` on success.

---

## Step 4 — Publish as a Web App

1. Top-right: **Deploy → New deployment**.
2. Click the gear ⚙ next to "Select type" → choose **Web app**.
3. Fill the fields **exactly**:
   - **Description:** `lead intake v1` (anything)
   - **Execute as:** **Me (your@gmail.com)**
   - **Who has access:** **Anyone**  ← must be "Anyone", not "Anyone with Google account"
4. Click **Deploy**.
5. **Authorize:** a prompt appears → **Authorize access** → pick your account →
   "Google hasn't verified this app" → **Advanced** → **Go to (project name) (unsafe)**
   → **Allow**. (This is your own script; it's safe.)
6. Copy the **Web app URL**. It ends in `/exec`, e.g.:
   ```
   https://script.google.com/macros/s/AKfycb................/exec
   ```

> Keep this `/exec` URL. You'll paste it in Step 5.

---

## Step 5 — Place the `/exec` URL in the funnel config

Open the funnel config and set `analytics.sheetsEndpoint` to your `/exec` URL.

- FreelanceX: `configs/freelancex.json` → line ~212
- ASQ: `configs/asq-perfume.json` → line ~194

Change the placeholder:

```json
"analytics": { "sinks": ["sheets"], "sheetsEndpoint": "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE" },
```

to your real URL:

```json
"analytics": { "sinks": ["sheets"], "sheetsEndpoint": "https://script.google.com/macros/s/AKfycb..../exec" },
```

Or do it from the terminal (replace the URL):

```bash
cd fulltimedigi-engine-v0
URL="https://script.google.com/macros/s/AKfycb..../exec"
# macOS sed:
sed -i '' "s#PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE#$URL#" configs/freelancex.json configs/asq-perfume.json
# verify:
grep sheetsEndpoint configs/freelancex.json configs/asq-perfume.json
```

---

## Step 6 — Verify a REAL lead is written

### 6a. Deterministic check with `curl` (recommended)

This posts a lead exactly like the funnel does and prints the server's reply. Replace
`<EXEC_URL>` with your `/exec` URL:

```bash
curl -L -X POST "<EXEC_URL>" \
  -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"email":"test@example.com","name":"Test Lead","phone":"+96550000000","primaryArchetypeName":"الحضور الراسخ","secondaryArchetype":"intimate","flags":["EN_GOOD"],"scores":{"rooted":8},"answers":{"identity":"intimate"},"source":"Manual Test","timestamp":"2026-05-30T00:00:00Z","dedupeKey":"test@example.com"}'
```

- The `-L` is required (Apps Script redirects `/exec`).
- **Expected output:**
  ```
  {"ok":true}
  ```
- Now open the Sheet → a **`Leads`** tab exists with a header row and one row for
  `test@example.com`.

**Test the upsert (no duplicates):** run the same command again but change
`"name":"Test Lead"` to `"name":"Test Lead 2"`. The existing row **updates** (name
changes); a second row is **not** added.

### 6b. Real funnel check (full user path)

```bash
cd fulltimedigi-engine-v0
npm run serve
# open http://localhost:8000/examples/freelancex/  (or /examples/asq-perfume/)
```

Complete the funnel, fill name + email, click submit. The result page appears and a new
row lands in the Sheet.

> **Why the browser shows no confirmation:** Apps Script doesn't send CORS headers, so
> the browser posts in `no-cors` mode and can't read the `{"ok":true}` reply. The row is
> still written. Use the `curl` check (6a) when you need to *see* confirmation. The
> engine also keeps a localStorage backup of every submitted lead under the key
> `ftd:leads:<funnelId>`.

---

## Column reference (the `Leads` tab)

Written in this order (header row auto-created):

| # | Header | Source field |
|---|---|---|
| 1 | التاريخ والوقت | `timestamp` |
| 2 | الاسم | `name` |
| 3 | الإيميل | `email` (lowercased) — **dedupe key** |
| 4 | الجوال | `phone` |
| 5 | المسار الأول | `primaryArchetypeName` (or `primaryArchetype`) |
| 6 | المسار الثاني | `secondaryArchetype` |
| 7 | الـ Flags | `flags` (comma-joined) |
| 8 | النتائج (Scores) | `scores` (JSON) |
| 9 | الإجابات | `answers` (JSON) |
| 10 | المصدر | `source` (funnel brand name) |

---

## After ANY edit to `Code.gs` — re-deploy a new version

Saving the script is **not** enough; the live `/exec` keeps serving the old version
until you publish a new one:

1. **Deploy → Manage deployments**.
2. Click the ✏️ (edit) on the existing deployment.
3. **Version → New version** → **Deploy**.

The `/exec` URL stays the same — no config change needed.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `curl` returns HTML / login page | "Who has access" isn't **Anyone**. Re-deploy with Anyone. |
| `curl` returns `{"ok":false,"error":...}` | Body isn't valid JSON, or you edited `Code.gs` without re-deploying a new version. |
| No row appears | Confirm you used the `/exec` URL (not `/dev`); add `-L` to `curl`; re-deploy new version. |
| Browser submit shows error, won't reach result | `sheetsEndpoint` is still the placeholder or unreachable. Use **skip** to continue, fix the URL, retry. |
| Arabic shows as `?`/mojibake | Ensure the POST is UTF-8 (`charset=utf-8` header, as above). |
| Edits to script not taking effect | You saved but didn't **Deploy → Manage deployments → New version**. |

---

## Done

When `curl` returns `{"ok":true}` and you see the row in the **`Leads`** tab, lead
capture is live end-to-end. Repeat Steps 1–5 with a separate Sheet per client; paste
each client's `/exec` URL into that client's config.
