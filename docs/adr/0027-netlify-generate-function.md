# ADR-0027 — Stage 3C-1: the server-side generator (Netlify Function)

- **Status:** Accepted (code built + locally proven; the live preview needs one operator step)
- **Date:** 2026-07-23
- **Scope:** Stage 3C-1 from the approved plan (ADR-0026). The first server piece: run the
  deterministic generation pipeline on a **Netlify Function** so real client sites can be
  read (removes the browser CORS limit). **No production change** — preview-only.

## Context

Everything up to now generates in the browser, which cannot fetch an arbitrary cross-origin
site (CORS) — so live generation from a real client URL is impossible client-side. A Node
server has **no CORS restriction on outbound fetches**, so moving `generateFunnelFromUrl`
onto a serverless function is the whole unlock (ADR-0026 §3C-1). Netlify is the target host
(ADR-0025): the existing site already deploys there, and a **Deploy Preview** gives a real,
isolated URL without touching production.

## Decision

- **`netlify/functions/generate.mjs`** — a Netlify Function (classic `export const handler`,
  ESM) that:
  - Accepts `POST` JSON `{ url, goal, authorized }`; `OPTIONS` → CORS preflight; other
    methods → `405`.
  - Validates the URL with the **same pure `buildIntake`** the screen uses (`400` +
    `invalid-url` on junk).
  - Enforces the **authorized-sites-only** scope (ADR-0013): `authorized !== true` → `403`
    `not-authorized`. (The account layer in 3C-2 will bind this to the tenant's own/verified
    domains.)
  - Runs the **real, tested `generateFunnelFromUrl`** and returns `{ ok, config, trust,
    bland, catalog:{origin,count} }` on success; on a pipeline failure returns `422` +
    `{ ok:false, stage, reason }` (honest — a real answer, not a crash). Never fabricates.
  - Sends CORS headers on every response (the Studio may call it cross-origin).
- **`netlify.toml`** — points Netlify at `netlify/functions`, publishes the repo statically
  for the preview, and adds an `Access-Control-Allow-Origin` header for `/embed/*` (the
  deploy note from ADR-0021 — the `type=module` embed loader needs CORS on our origin).
- **`platform/intake/start.html`** — now **prefers the server function** (`POST
  /.netlify/functions/generate`) and **falls back to the in-browser pipeline** when the
  function isn't reachable (local `npm run serve`, or the bundled sample). Same UI, no
  visible change: on Netlify real URLs work; locally the sample still works.

### Why a thin function (not a rewrite)
The function is a ~40-line adapter over the already-green pipeline — request parsing,
validation, scope check, honest response shaping. All the real logic (ingest, author, both
gates) is unchanged and stays covered by its existing suites; the function adds its own
request/response tests.

## Verification (local, no Netlify account needed)

Proven in Node by invoking the handler directly against the **same-origin sample shop served
over HTTP** — a URL the *browser* refused cross-origin, which the *server* reads with plain
`fetch` (no CORS). Asserts: `OPTIONS`/method guards, `invalid-url`, `not-authorized`, and a
real success (config + both gates green + product count). The Netlify Deploy Preview itself
requires the operator's one connect step (below).

## Operator step (the only thing I can't do)

I cannot spin up the Netlify preview myself (it needs the Netlify account + the live repo).
To make this function live on a **preview URL** (production untouched), the operator does one
of: (a) authorize adding the `fulltimedigi-interactive-builder` repo so the function deploys
via the existing Netlify wiring as a Deploy Preview; or (b) connect this platform repo to a
Netlify site for a preview. Click-by-click steps are provided in chat when the operator
picks. Until then the code is committed, tested, and ready.

## Consequences

- The CORS barrier is removed **in code and proven locally**; real client URLs generate once
  the preview is connected.
- Production stays safe (preview-only; ADR-0026 §5).
- 3C-2 (accounts + storage) will sit in front of this function (bind `authorized` to the
  tenant's verified domains; persist the returned config per tenant).
