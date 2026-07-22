# Deploy

> Foundation placeholder (SPEC §13). Full steps written during build.

## Frontend (static — no build step)
- Host the funnel folder (shell `index.html` + its `config.json`) on **Netlify**
  (or any static host). No build command; ES modules served directly.
- Set CSP `connect-src` to allow the Apps Script endpoint + analytics.
- Performance budget: interactive < 1.5s on 4G mobile; preconnect fonts.

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
