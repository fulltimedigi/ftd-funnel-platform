# ADR-0032 — Interim security hardening (audit PASS 2, Group 1)

Status: Accepted · 2026-07-23 · interim until real accounts land in Stage 3ج-2

## Context

The generator fetches arbitrary user-supplied URLs server-side and runs a paid model
behind public Netlify Functions. A code audit surfaced a "safe batch" of real, fixable
weaknesses to close now — without building full auth yet (that is 3ج-2).

## Decisions

1. **SSRF guard (`authoring/ingest/ssrfGuard.js`).** A pure, DNS-free classifier blocks
   loopback / RFC1918 / link-local (169.254/16, incl. 169.254.169.254 metadata) / CGNAT /
   IPv6 `::1`, `fc00::/7`, `fe80::/10` / `*.internal` / `metadata.*`. The fetcher validates
   the URL **before the first byte** and **re-validates every redirect hop**
   (`redirect:"manual"`, capped at 5). `normalizeUrl` applies the same guard and drops
   `localhost` in production (`NODE_ENV=production`); `generate-submit` re-checks with
   `allowLocalhost:false` so localhost is never fetched server-side even if `NODE_ENV`
   is unset. Residual risk: DNS rebinding (a public name resolving to a private IP) —
   closed in 3ج-2 with a resolve-then-pin fetch; noted honestly, not silently.

2. **Retire the dead sync endpoint (`generate.mjs`).** It 504'd after spending the key.
   It now returns **501** pointing at the async flow and never touches the network/model.
   The `/api/generate` redirect was removed.

3. **Lock down the background function.** `generate-background` requires an internal shared
   secret header (`x-ftd-internal` = `FTD_INTERNAL_SECRET`, set by the submit trigger) so it
   can't be invoked externally; the whole handler is wrapped so any failure writes an honest
   `{status:"error", reason:"storage-unavailable"}` record (no perpetual "pending"). The
   write key is derived server-side (`keyFor` = salt+url), never from raw caller input.

4. **Interim endpoint gate + abuse cap.** `generate-submit`/`generate-status` accept an
   optional shared token (`x-ftd-token` = `FTD_PUBLIC_TOKEN`, enforced only when set — the
   real per-user gate arrives in 3ج-2). A global **daily cap** (`FTD_DAILY_CAP`, default
   200) counted in Blobs runs **before any Opus call**. Job ids are salted
   (`FTD_ID_SALT`), so a cached result can't be read by guessing the URL — same salt+URL
   still maps to the same cache key.

5. **Tighten CORS** from `*` to a first-party allowlist (`FTD_ALLOWED_ORIGINS`, default =
   the preview + fulltimedigi.com), echoing the request Origin only if allow-listed.

6. **Sanitize `href` (`engine/dom.js` `safeHref`).** Only http/https/mailto/relative pass;
   `javascript:`/`data:`/etc. (incl. control-char-obfuscated) are dropped — a poisoned or
   scraped config can't inject a script URL.

7. **Security headers (`netlify.toml`).** CSP, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`, HSTS on all responses; `/embed/*`
   overrides frame rules (it is legitimately embedded cross-origin, ADR-0021).

## Consequences

- No gate weakened; no fabrication; honest failures preserved. New env vars
  (`FTD_INTERNAL_SECRET`, `FTD_ID_SALT`, optional `FTD_PUBLIC_TOKEN`, `FTD_DAILY_CAP`,
  `FTD_ALLOWED_ORIGINS`) are **all optional** — unset means the previously-working preview
  keeps working, with each protection activating as its env is set. The operator is given
  dead-simple steps to set the two that matter most (`FTD_INTERNAL_SECRET`, `FTD_ID_SALT`).
- CSP keeps `'unsafe-inline'` until inline scripts/styles are externalized (tracked for
  3ج-2) — documented, not hidden.
- Tests: SSRF classifier + fetcher redirect refusal, `safeHref`, salted key + spend-cap
  guard, retired-endpoint 501, endpoint token/CORS/SSRF gating. All suites stay green.
