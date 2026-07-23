# ADR-0029 — Async background generation + per-store design cache

- **Status:** Accepted
- **Date:** 2026-07-24
- **Scope:** Move heavy AI authoring off the synchronous HTTP path. Builds on ADR-0027
  (sync generate function), ADR-0028 (grounded AI authoring). Preview-only; live site
  untouched. Design model stays **`claude-opus-4-8`** (operator: best quality, cost no
  object — the background job removes the timeout that would have forced a downgrade).

## Context

With the API key set and the schema fixed, grounded AI authoring genuinely runs — verified
live: a junk URL fast-fails (400 in 0.7s), but **real oudfactory 504s at ~31s**. Opus 4.8
authoring a rich design for 51 products exceeds Netlify's **~26s synchronous function
limit**. The sync request/response shape is simply the wrong architecture for minutes-long
AI generation.

Two facts make async the right fit: Netlify **Background Functions** (a function named
`*-background`) may run up to **15 minutes**, and we already planned to **cache the design
per store URL** — so the same store is authored once and served instantly thereafter.

## Decision

**Submit → background → poll, with a per-store cache in Netlify Blobs.**

1. **Key = a hash of the normalized URL** (`sha256`, first 32 hex). This id is BOTH the job
   id and the cache key — same store → same key → same cached design.
2. **`generate-submit`** (fast fn): normalize + validate the URL → key. Read Blobs[key]:
   - **ready and not `regenerate`** → return `{id, status:"ready"}` (cache hit = instant).
   - else → write a `{status:"pending"}` marker, **trigger** `generate-background` (fire the
     function URL; it returns 202 immediately), return `{id, status:"pending"}`.
3. **`generate-background`** (`*-background`, up to 15 min): run `generateFunnelFromUrl` with
   the AI enricher → write the full record (`config`, `source`, `trust`, `bland`,
   `richness`, `ai` diagnostic) to **Blobs[key]** as `{status:"ready", …}`; on a hard
   failure write `{status:"error", reason}`. **Honest fallback preserved:** if the AI job
   fails (no key / refusal / error), the stored result is the **deterministic** funnel with
   the real `ai.reason` recorded — never a fake-rich funnel.
4. **`generate-status`** (fast fn): `GET ?id=<key>` → the Blobs record (`pending` / `ready`
   with the config / `error` / `unknown`).
5. **Client (paste screen):** POST the URL → get the id → show the **live anticipation
   state** ("بنقرأ متجرك… بنصمّم القرار…") → **poll status** until ready → render the funnel.
   Keeps the approved UX standard (honest failure, deferred signup, no fake success). Local
   dev (no functions) falls back to the existing in-browser deterministic path.
6. **Regenerate:** submit with `regenerate:true` bypasses the cache and re-authors.

**Speed win (ADR-0028 schema, applied here too):** the design's `productValues` maps by
**product index `{i, value}`** instead of full URL — URLs are long, so this ~5×-shrinks the
model's output, cutting latency and cost. `designToAxes` resolves index → real URL
deterministically (and still drops any out-of-range index — grounding intact).

### Testability

The job orchestration is a **pure core** (`platform/jobs/generateJob.js`) over an **injected
store** (`{get, set}`) and an **injected `generate`** — so submit / status / background-run /
cache-hit / honest-fallback are all unit-tested with a Map-backed fake store and a fake
generator, no Netlify and no network. The Netlify functions are thin wrappers that supply the
real Blobs store (dynamically imported `@netlify/blobs`, so `npm test` never loads it) and
the real enricher.

## Consequences

- Heavy Opus authoring is no longer bound by the sync timeout; the funnel arrives when it's
  ready (seconds→minutes), and **the same store is instant on every subsequent visit** (the
  design cache).
- Guardrails unchanged: gates never weakened, every result binds to a real SKU+URL, honest
  fallback with the real `ai.reason`.
- `@netlify/blobs` is a build-time dependency of the functions only; the engine, the tests,
  and CI stay dependency-free (`npm test` runs `node` directly, importing nothing new).
- The live oudfactory comparison against the hand-built reference now runs without timing out.
