# Deploy

> Foundation placeholder (SPEC §13). Full steps written during build.

## Frontend (static — no build step)
- Host the funnel folder (shell `index.html` + its `config.json`) on **Netlify**
  (or any static host). No build command; ES modules served directly.
- Performance budget: interactive < 1.5s on 4G mobile; preconnect fonts.

### Content-Security-Policy (must allow GA4 + Apps Script + Google Fonts)

A CSP that omits the GA4 domains silently kills the GA4 analytics sink (the
`gtag.js` script never loads and no events are sent) — this was a carried bug
from the production engine (ADR-0003 / ADR-0011). Ship this policy (as a Netlify
`_headers`/`netlify.toml` response header — preferred — or the `<meta>` fallback):

```
Content-Security-Policy:
  default-src 'self';
  script-src  'self' https://www.googletagmanager.com;
  connect-src 'self' https://script.google.com https://script.googleusercontent.com
              https://www.google-analytics.com https://region1.google-analytics.com
              https://www.googletagmanager.com;
  img-src     'self' data: https://www.google-analytics.com https://www.googletagmanager.com;
  style-src   'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src    'self' https://fonts.gstatic.com;
  form-action 'self' https://script.google.com;
  base-uri    'self';
```

Why each entry:
- `script-src … googletagmanager.com` — loads `gtag.js` (**the GA4 fix**).
- `connect-src … google-analytics.com, region1.google-analytics.com, googletagmanager.com`
  — where GA4 sends hits; `script.google[usercontent].com` — the Apps Script
  `/exec` lead + event POSTs (it 302-redirects to `…usercontent.com`).
- `style-src 'unsafe-inline'` — the engine sets inline `style` attrs (e.g. bar
  widths) and injects the theme `<link>`; `fonts.googleapis.com` — theme font CSS
  (e.g. `luxury-gold-light`). `font-src fonts.gstatic.com` — the font files.
- `form-action script.google.com` — the lead form's endpoint.

Only `sheets` (no GA4)? Drop the two `googletagmanager.com` / `google-analytics.com`
lines. Custom fonts self-hosted? Drop the Google Fonts lines. Never widen to
`default-src *` to "make it work" — add the specific origin instead.

## Backend (leads + events)
- See `integrations/google-apps-script/SETUP.md`.
- Paste the `/exec` URL into the funnel config `analytics.sheetsEndpoint`.

## Verify before calling it live
- Submit a **real test lead** and confirm the row lands in the Sheet.
- Confirm analytics events land in the Events tab.
- Test on a real mobile device in Arabic RTL.

## TODO (during build)
- Netlify config + pretty URLs.
- Per-funnel folder convention under `examples/`.
