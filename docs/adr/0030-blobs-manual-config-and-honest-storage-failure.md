# ADR-0030 — Blobs manual config + honest storage failure (async generation actually runs)

Status: Accepted · 2026-07-23 · supersedes the storage assumption in ADR-0029

## Context

ADR-0029 moved heavy AI authoring to a background function and persisted the result
in **Netlify Blobs** (a per-store design cache), polled by the client. On the operator's
preview site (`ftd-studio-preview.netlify.app`) the whole path was **dead on arrival**:

```
generate-submit → MissingBlobsEnvironmentError
"The environment has not been configured to use Netlify Blobs.
 To use it manually, supply the following properties: siteID, token"
```

A runtime probe (`blobprobe`, since removed) established the facts, not guesses:

| Signal | Value | Meaning |
|---|---|---|
| `NETLIFY_BLOBS_CONTEXT` | **absent** | Blobs **auto**-config is not injected on this site |
| `globalThis.Netlify` | **absent** | not the modern managed Functions runtime |
| `CONTEXT`, `DEPLOY_ID`, `DEPLOY_PRIME_URL` | **absent** | the standard managed-runtime env is not present at all |
| `SITE_ID` | **present** | we have the site id needed for manual config |
| `ANTHROPIC_API_KEY` | **present** | the AI key was never the problem |
| manual `getStore({name, siteID, token})` | would run — only a **token** is missing | |

So the AI (`claude-opus-4-8`) was never the failure. **Storage was.** And because
`generate-submit` threw instead of returning our JSON contract, the browser **silently
fell back to the in-browser pipeline** — which has no server API key, so **no AI** — and
slowly crawled the store to emit the thin deterministic funnel. That is exactly what the
operator saw: "~2 minutes, then the same old 2-question funnel."

Two independent defects:
1. **Storage never worked** → the background/AI path never executed.
2. **The client hid the failure** → a server error degraded into a misleading (AI-less)
   result instead of an honest message. This violates the "honest failure, never report
   success you can't confirm" law.

The site is on the operator's own Netlify account; the Netlify MCP available to the
engineer is a *different* account (0 sites) and cannot set env vars on it. So the token
must be added by the operator — one variable, once.

## Options researched

- **A. Restore Blobs auto-context** — not possible from code; this runtime simply doesn't
  inject it, and we cannot reconfigure the operator's Netlify site remotely.
- **B. A different external store (Supabase/KV)** — introduces a new vendor, ownership,
  and billing surface, and *still* needs credentials in the same Netlify env. No net win
  over native Blobs, more moving parts.
- **C. Netlify Blobs in *manual* mode (`siteID` + `token`)** — native, one secret, and
  the probe proved it is the only missing piece. **Chosen.**
- **D. Squeeze AI under the 26 s sync limit** — an Opus design call on a real catalog does
  not reliably fit; rejected as fragile (this is why ADR-0029 went async at all).

## Decision

1. **`createBlobStore` prefers manual config when a token is present.** It reads
   `NETLIFY_BLOBS_TOKEN` (or `NETLIFY_API_TOKEN`) + `SITE_ID` (or `NETLIFY_SITE_ID`) and
   calls `getStore({ name, siteID, token })`. If no token is set it falls back to
   `getStore(name)` (auto-context) so a properly-provisioned site keeps working with zero
   config. A one-shot `healthy()` check (tiny write+read) lets callers detect an
   unconfigured store *before* doing work.
2. **Honest storage failure end-to-end.** `generate-submit` now catches an unconfigured
   store and returns `{ ok:false, reason:"storage-unconfigured" }` (503) — our JSON
   contract, not a raw 500. `generate-status` reports `{status:"error",
   reason:"storage-unconfigured"}` rather than a stuck `pending`.
3. **No misleading silent fallback.** The Studio entry screen only uses the in-browser
   pipeline for the **same-origin sample** store (a genuine local-dev demo). For a real
   external URL, if the server path fails or is unreachable, it shows the **real reason**
   (including a plain-language note when storage just needs enabling) — it never degrades
   an external request into an AI-less thin funnel again.

## Consequences

- The instant the operator adds one env var (`NETLIFY_BLOBS_TOKEN`, a Netlify personal
  access token), the async AI path runs: submit → background Opus authoring → cached in
  Blobs → polled to the screen; a repeat of the same store is instant.
- Until then, the screen is **honest**: it says storage needs enabling instead of showing
  a wrong result. No law is bent to make something appear to work.
- Tests cover manual-vs-auto store selection (injected `getStore`), the `healthy()` probe,
  and the honest `storage-unconfigured` surfacing. CI stays dependency-free
  (`@netlify/blobs` is still only dynamically imported inside the functions).
- `SITE_ID` on the site must be the real site id (already set by the operator). If it is
  wrong, `healthy()` fails loudly — again, honestly.
```
