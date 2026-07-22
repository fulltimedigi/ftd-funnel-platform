# Runtime Verification Audit — FullTimeDigi Engine

**Date:** 2026-05-30
**Repo / commit audited:** `fulltimedigi-engine-v0` @ `4e8162e`
**Auditor:** runtime verification (execution-based, not source review)
**Environment:** macOS (Darwin 25.5.0), Node `v24.16.0`, Google Chrome headless (`--headless=new`)

> This audit verifies the engine by **actually running it**, not by reading the
> source. Every PASS/FAIL below is backed by a real command output captured
> during the run.

---

## Executive Summary

The engine was executed four ways: (a) Node test harnesses that drive the **real
controller** end-to-end; (b) JSON / module-graph probes; (c) a static HTTP server
with every asset curled; (d) **real headless Chrome** loading both example pages,
dumping the post-JavaScript DOM and the server access log.

**Verified working in real runtime (9 core behaviors):** both funnels load, scoring,
archetype resolution, result rendering (both layouts), **theme switching in an actual
browser**, localStorage persistence, lead-capture execution, clean boot with **no
app-level console errors**, and **no broken/missing assets**. Same engine code runs
FreelanceX (weighted-multi / tracks / platform theme) and ASQ (dominant / commerce /
luxury theme) — the engine model holds at runtime.

**Verified NOT working / NOT proven (the honest part):**

1. **Google Sheets integration is not live and has never delivered a lead.** Both
   configs ship a placeholder endpoint; `Code.gs` has never executed against a real
   sheet. The "lead appears in Sheets" success criterion remains **unproven**.
2. **Hidden runtime trap:** an unconfigured deployment (placeholder endpoint) blocks a
   user at the lead gate — submit fails and keeps them on the form; the only way
   through is the **skip** link.
3. **In-browser full click-through completion was not scripted** (that needs a
   browser automation lib = new code, which was out of scope). Completion was proven
   by the Node harness driving the *same controller code* the buttons call.
4. **Three dead engine modules** (`analytics.js`, `i18n-rtl.js`, `recommend.js`) ship
   in the tree, imported nowhere.

**Headline:** the *diagnostic* is real and runs in a browser. The *lead delivery to
Google Sheets* is the one capability presented as built that has **never actually
delivered a lead**, and requires a live Apps Script deploy before it can be claimed.

**Limitations of this audit:** no literal PNG screenshots were captured (headless, no
display) — the equivalent evidence is the **post-JS rendered DOM dump** from Chrome,
quoted below. See "Screenshot references."

---

## Scope — the 15 checks

| # | Check | Result |
|---|---|---|
| 1 | Does ASQ load successfully? | ✅ PASS |
| 2 | Does FreelanceX load successfully? | ✅ PASS |
| 3 | Can a user complete the funnel? | ⚠️ PASS (logic) / not click-tested in browser |
| 4 | Does scoring work correctly? | ✅ PASS |
| 5 | Does archetype resolution work? | ✅ PASS |
| 6 | Does result rendering work? | ✅ PASS |
| 7 | Does theme switching work? | ✅ PASS |
| 8 | Does localStorage persistence work? | ✅ PASS |
| 9 | Does lead capture execute? | ✅ PASS |
| 10 | Does the Google Sheets integration actually work? | ❌ FAIL — not live / never executed |
| 11 | Are there console errors? | ✅ PASS — none app-level |
| 12 | Are there broken assets? | ✅ PASS — none |
| 13 | Are there missing files? | ✅ PASS — none referenced |
| 14 | Are there dead code paths? | ⚠️ YES — 3 dead modules + stubs |
| 15 | Runtime failures not visible in source review? | ⚠️ YES — 2 found |

---

## Evidence by check

### 1 & 2 — ASQ and FreelanceX load successfully — ✅ PASS

Both example pages served HTTP 200 and **booted in real headless Chrome** (the
`#ftd-root` mount point was populated with the rendered hero after JS ran):

```
################ HEADLESS CHROME: asq-perfume ################
-- DOM bytes rendered:     1765
-- #ftd-root populated? (engine booted in browser):
id="ftd-root"><section class="ftd-screen ftd-hero"><p class="ftd-hero-eyebrow">The Scent Profi
-- theme <link> injected at runtime:
data-ftd-theme="luxury-gold-light"

################ HEADLESS CHROME: freelancex ################
-- DOM bytes rendered:     1673
-- #ftd-root populated? (engine booted in browser):
id="ftd-root"><section class="ftd-screen ftd-hero"><p class="ftd-hero-eyebrow">٥ مسارات · ٦ أس
-- theme <link> injected at runtime:
data-ftd-theme="platform-clean"
```

Config files parse as valid JSON:

```
OK   configs/freelancex.json (9391 bytes)
OK   configs/asq-perfume.json (10914 bytes)
OK   configs/_schema.json (7084 bytes)
```

A populated `#ftd-root` is proof of a **successful boot** — a fatal JS/import/fetch
error would have left it empty.

### 3 — Can a user complete the funnel? — ⚠️ PASS (logic) / not click-tested in browser

The Node harness drives the **real controller** (`createFunnel`) the same way the
on-screen buttons do — `start → select → next` through every question, then the lead
step, then the result. Both funnels complete:

```
Full run A — development path (with EN_GOOD flag):
  ✓ reaches result view
  ✓ all 6 answers were saved
...
Dual-engine proof — same code, different funnels:
  ✓ FreelanceX still works end-to-end on the shared engine
```

```
ASQ runs dominant scoring (every question matters):
  ✓ primary = rooted, decided by Q2–Q5 not just Q1
ASQ renders the COMMERCE layout (config-driven dispatch):
  ✓ result section is commerce, not tracks
```

**Caveat (honest):** in the real browser I verified boot + hero render only. I did
**not** script clicks through Chrome (that requires a browser-automation library =
new code, which was out of scope). Completion is proven at the controller level — the
exact code path the buttons invoke.

### 4 — Scoring works correctly — ✅ PASS

13/13 scoring assertions, plus exact values observed in live funnel runs:

```
FreelanceX (weighted-multi):
  ✓ weights multiply (q2 weight 2) and URGENT flag adjusts
  ✓ primary/secondary/flags/sorted correct
...
PASS — all 13 scoring assertions passed.
```

Observed values: FreelanceX `development = 30` (incl. `EN_GOOD +2`), `copywriting = 23`
(with `development` clamped to 0 under URGENT/AR_ONLY); ASQ `rooted = 8`.

### 5 — Archetype resolution works — ✅ PASS

```
  ✓ primary = development, secondary = graphic_design        (FreelanceX run A)
  ✓ primary = copywriting, secondary = freelance_start       (FreelanceX run B)
  ✓ primary = rooted, secondary = intimate                    (ASQ — decided by Q2–Q5)
```

ASQ’s `primary = rooted` despite Q1 = `intimate` proves resolution uses **all**
answers (the original demo’s "Q1 dominates" theater is gone).

### 6 — Result rendering works — ✅ PASS

Tracks layout (FreelanceX) and commerce layout (ASQ) both render from config:

```
  ✓ result screen shows the archetype + a because + score bars + CTA   (tracks)
  ✓ shows signature recommendation, price, because, contextual grid, shop CTA  (commerce)
  ✓ commerce layout has NO score-distribution bars
  ✓ result section is commerce, not tracks
```

ASQ commerce content observed: `توقيعك العطري`, signature `المزيج الملكي`, price
`٣٤ د.ك`, discount `خصم ٥٠٪`, resolved because containing `العود`, contextual title
`لكل مناسبة`, best-for-you badge `الأنسب لك`, shop CTA `تسوّق`.

### 7 — Theme switching works — ✅ PASS (verified in real browser)

The engine injected a different theme `<link>` per config, and Chrome **fetched both
theme stylesheets** at runtime (from the HTTP access log):

```
data-ftd-theme="luxury-gold-light"     (ASQ page)
data-ftd-theme="platform-clean"        (FreelanceX page)

200  GET /themes/luxury-gold-light.css HTTP/1.1
200  GET /themes/platform-clean.css HTTP/1.1
```

Same engine code, theme selected by `config.theme`, loaded by a real browser.

### 8 — localStorage persistence works — ✅ PASS

```
Navigation + restart + persistence:
  ✓ progress is persisted to localStorage
  ✓ restart clears state and returns to hero
```

```
sheets-sink transport:
  ✓ submitted lead is kept in a localStorage audit queue
```

Keys observed: `ftd:freelancex` (answers/step/history), `ftd:leads:<funnelId>` (audit).

### 9 — Lead capture executes — ✅ PASS

```
Lead form renders after the last question:
  ✓ view becomes 'lead' and form shows fields + skip
  ✓ submit is disabled until valid, enabled after fill
Submit → tagged payload reaches the transport:
  ✓ payload carries email, archetype, flags, answers, dedupeKey; then shows result
Skip path:
  ✓ skipping reaches result without calling the transport
Failure path (no silent success):
  ✓ failed submit keeps user on the lead form (does not advance)
```

The submitted payload is correctly tagged (email, `dedupeKey` lowercased,
`primaryArchetype`, `flags`, all answers).

### 10 — Does Google Sheets integration actually work? — ❌ FAIL (not live, never executed)

Both configs ship a **placeholder** endpoint:

```
configs/freelancex.json:"sheetsEndpoint": "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE"
configs/asq-perfume.json:"sheetsEndpoint": "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE"
```

- `sheets-sink` correctly refuses the placeholder — returns `{ok:false, reason:'no-endpoint'}`
  and makes **no** network call (verified).
- With a real-looking endpoint + a fake `fetch`, the transport POSTs a correct JSON
  body containing the email (verified) — this proves the **request is well-formed**,
  **not** that a row lands in a sheet.
- `integrations/google-apps-script/Code.gs` is written but **cannot execute here** (it
  needs Google’s Apps Script runtime) and **has never run against a real spreadsheet**.

**Conclusion: the lead → Google Sheet loop is unverified. A real row in a real
spreadsheet has not been observed.** Verifying it requires a manual Apps Script deploy
and pasting the live `/exec` URL into the config.

### 11 — Console errors — ✅ PASS (none app-level)

Headless Chrome stderr contained only macOS display-subsystem warnings, unrelated to
the app:

```
[ERROR:ui/display/mac/cv_display_link_mac.mm:184] CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670
```

No `Uncaught`, no module/import errors, no failed `fetch`. The populated `#ftd-root`
(checks 1–2) independently confirms boot completed without a fatal error.

### 12 — Broken assets — ✅ PASS (none)

Every asset the browser requested returned 200 (19 app assets). The **only** non-200
was the browser’s automatic favicon request, which the app does not reference:

```
200  GET /engine/index.js HTTP/1.1
200  GET /engine/scoring.js HTTP/1.1
200  GET /configs/asq-perfume.json HTTP/1.1
200  GET /themes/luxury-gold-light.css HTTP/1.1
... (all 19 app assets 200) ...
404  GET /favicon.ico HTTP/1.1        <-- cosmetic, not referenced by the app
```

### 13 — Missing files — ✅ PASS (none referenced)

The engine entry module graph imports cleanly:

```
engine/index.js graph imported OK
```

Both theme files exist on disk:

```
EXISTS ./themes/platform-clean.css (897B)
EXISTS ./themes/luxury-gold-light.css (1009B)
```

### 14 — Dead code paths — ⚠️ YES

Three engine modules are imported nowhere, plus stub sinks and a dead shell:

```
DEAD/UNWIRED: engine/analytics.js      (stub, imported nowhere)
DEAD/UNWIRED: engine/i18n-rtl.js       (stub, imported nowhere)
DEAD/UNWIRED: engine/recommend.js      (stub — resultRenderer does `because` inline instead)
Stubs still throwing 'not implemented': engine/i18n-rtl.js, engine/analytics.js,
                                        engine/recommend.js, analytics/ga4-sink.js
```

Reachable engine graph (imported by `index.js`): `dom, state, flow, questionRenderer,
resultRenderer, leadCapture, scoring, resolver, ../analytics/sheets-sink`
(`progress.js` is live transitively via `questionRenderer`). Also dead:
`templates/index.html` (its boot `<script>` is commented out; the live shells are in
`examples/`).

### 15 — Runtime failures not visible in source review — ⚠️ 2 found

**15(a) — Unconfigured endpoint traps the user at the lead gate (HIGH).**
With the placeholder endpoint, completing the form and clicking submit yields
`{ok:false}` from `sheets-sink`, so `leadCapture` shows
`"تعذّر حفظ بياناتك. حاول مرة أخرى أو تخطَّ."` and **keeps the user on the form**.
The only way to the result is the **skip** link. This is the "no silent success"
design working — but it means an unconfigured deployment blocks completion. Not
visible in source review; only surfaces at runtime.

**15(b) — Theme `<link>` re-injected per `createFunnel` (LOW).**
`loadTheme()` appends a new `<link>` on every `createFunnel()` call with no dedupe.
Benign today (one funnel per page); would stack duplicate stylesheets if a page ever
instantiated two funnels.

**Cosmetic (not failures):** progress uses **Western numerals** ("1 / 6") in an Arabic
RTL UI (`i18n-rtl` is a dead stub); Google-Fonts `@import`s require network, so the
serif-gold vs Cairo-cyan *visual* difference is asserted structurally (theme injected +
tokens set), not captured as an image.

---

## Screenshot references

Literal PNG screenshots were **not** captured (headless run, no display). The
equivalent runtime evidence is the **post-JavaScript rendered DOM** dumped by Chrome
and the HTTP access log:

- ASQ rendered DOM (excerpt): `#ftd-root` → `<section class="ftd-screen ftd-hero">…The Scent Profile…`, head contains `data-ftd-theme="luxury-gold-light"`.
- FreelanceX rendered DOM (excerpt): `#ftd-root` → `<section class="ftd-screen ftd-hero">…٥ مسارات · ٦ أسئلة…`, head contains `data-ftd-theme="platform-clean"`.
- Access log: 19/19 app assets HTTP 200, including both theme stylesheets.

To capture true screenshots: `npm run serve`, then open
`http://localhost:8000/examples/freelancex/` and `/examples/asq-perfume/` in a
desktop browser. (Reproduce this audit’s DOM dump with
`chrome --headless=new --dump-dom --virtual-time-budget=9000 <url>`.)

---

## Reproduction commands

```bash
# 1. Engine harnesses (drive the real controller end-to-end)
node tests/scoring.test.mjs
node tests/funnel.freelancex.test.mjs
node tests/leadloop.test.mjs
node tests/asq.test.mjs
# or: npm test

# 2. Config + module-graph probes
node -e "JSON.parse(require('fs').readFileSync('configs/asq-perfume.json','utf8'))"
node --input-type=module -e "import('./engine/index.js').then(()=>console.log('OK'))"

# 3. Static serve + asset check
python3 -m http.server 8137 &
curl -s -o /dev/null -w "%{http_code}" http://localhost:8137/examples/asq-perfume/

# 4. Real browser load + DOM dump
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --dump-dom --virtual-time-budget=9000 \
  http://localhost:8137/examples/asq-perfume/
```

---

## Final verdict

| Area | Status |
|---|---|
| Load (both funnels) | ✅ verified in real browser |
| Scoring / resolution / result rendering | ✅ verified by execution |
| Theme switching | ✅ verified in real browser (both CSS fetched) |
| localStorage persistence | ✅ verified |
| Lead-capture execution | ✅ verified |
| Console errors / broken assets / missing files | ✅ none (app-level) |
| **Google Sheets delivery (lead → row)** | ❌ **not live, never executed** |
| In-browser full click-through | ⚠️ not scripted (driven via Node controller) |
| Dead code (3 modules + stubs) | ⚠️ present |
| Unconfigured-endpoint lead trap | ⚠️ real runtime UX failure |

**Total executable assertions across harnesses: 46/46 passing**
(scoring 13 + funnel 14 + lead-loop 11 + engine-model 8).

The engine runs, renders, scores, resolves, themes, and persists — proven by
execution in Node and a real browser. The lead loop **executes** but its final hop —
writing to Google Sheets — is **unverified and not live**, and an unconfigured deploy
traps users at the lead gate. Those are the gaps to close before any production or
client claim.
