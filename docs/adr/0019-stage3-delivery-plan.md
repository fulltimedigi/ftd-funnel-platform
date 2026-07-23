# ADR-0019 — Stage 3 (Platform & Delivery): plan and build order

- **Status:** Proposed (3A approved to build — Webhook sink first; 3B/3C await operator approval)
- **Date:** 2026-07-23
- **Scope:** Stage 3. Binding inputs: `docs/PRODUCT_DECISIONS.md`, `docs/ROADMAP.md`.

## Context

Stages 0–2 are merged and live-proven: a brand URL → a real catalog → a fact-based,
trust-and-anti-bland-passing funnel `config`. Stage 3 is **the platform + delivery**.

**Vision correction (operator, 2026-07-23):** `fulltimedigi.com` **is the product — a
multi-tenant SaaS platform**, not a place we host client funnels. A client signs in with
their account, pastes their store URL, generates a funnel through the Studio, reviews/edits
it, and **publishes it themselves**. The generated funnels are then served as embed/page/
file to *their* sites; the platform is the app, not the funnel host.

**Key architectural lever:** our authoring is **deterministic code** (`authoring/` — ingest
+ author, no `Math.random`, fully tested). So the **platform runs the pipeline itself,
server-side**, and generates each client's funnel **without a Claude session per client** —
fast, cheap, and scalable. Claude built the engine; the platform *operates* it.

`docs/PRODUCT_DECISIONS.md` (binding) fixes the shape: **one `config`, three packagings**
(hosted page · **embed** iframe/one-line — the hero "top of the client's site" format ·
single self-contained HTML) and a **configurable lead sink with a rich payload**; the
**universal Webhook sink** unlocks GHL/Zapier/Make/CRMs at once (integrate, never compete).

Today's delivery is only the `examples/<name>/index.html` shell. No webhook, no embed, no
single-file, no accounts, no publish path.

## Decision — build order and why

### 3A — Delivery layer (build FIRST; 3B and 3C consume it)

Self-contained, **offline-testable** (pure transforms + injected transports). Sub-order by
value ÷ risk:

1. **Webhook sink** (`analytics/webhook-sink.js`) — **first, and approved to build now.**
   Smallest, highest leverage: one sink → GHL/Zapier/Make/most CRMs. Mirrors the proven
   `sheets-sink.js` (`registerSink` + honest failure, never fakes success), carrying the
   **rich payload** (email + answers + recommended real product + archetype + score).
   Pure, injected-`fetch`, fully offline-testable. Independent of the SaaS decisions below.
2. **Hosted page + Embed** — the *hero* format: a config-driven funnel page + a one-line
   **`embed.js`** that drops an **auto-resizing sandboxed iframe** (postMessage height,
   origin-checked) into the client's own site. **No bundler needed** — ships early; this is
   how funnels embed at the top of a client's site and inside GHL.
3. **Single self-contained HTML file** — portability/hand-off. A dependency-free inliner
   (engine + config + CSS → one `.html`). **Deferred, own ADR** — inlining the ES-module
   graph is the one fiddly piece; not rushed.

### 3B — Studio → a multi-tenant SaaS app (revised)

Expands from an internal console into the **customer-facing platform**:

- **Accounts + tenant isolation** — each client has an account; their sites, catalogs,
  funnels, leads, and sink config are **strictly separated** (authz on every read/write; no
  cross-tenant leakage — the same discipline as the per-funnel backend isolation, ADR-0012).
- **Server-side generation** — the app runs `generateFunnelFromUrl()` (ingest + author) on
  its **own backend**, deterministically, per request. No LLM call, no Claude session per
  client → seconds and cents, not a manual job.
- **Draft → review → refine → publish** (PRODUCT_DECISIONS §1): paste URL → auto-generate →
  **review** (show the gate results + a live preview) → optional **refine panel** (edit the
  AI draft: goal, hero products, length, result style, lead fields/sink) → **publish** (emit
  the chosen packaging from 3A + register the sink).
- Studio's UI lives in a separate app; **this repo provides the clean, tested engine of it**
  (authoring API + a `publish()` step), so the platform is a thin, well-tested layer.

### 3C — Deploy the PLATFORM (revised)

We host **the app itself** — a **Node backend** (accounts, tenant data, the server-side
authoring pipeline) + a UI — and the **generated funnels go to a static CDN** (cheap,
fast, cacheable), namespaced per tenant. This is **not** pure static hosting anymore, so the
hosting choice is **re-opened** (see the open question). Custom domain, per-client funnel
URLs, production CSP (already drafted).

## First concrete build (now): the Webhook sink

Approved. Smallest, highest-leverage, lowest-risk, fully offline-testable — a clean first
win that unblocks all integrations, independent of the SaaS/hosting decisions.

## Key considerations (called out up front)

- **Multi-tenancy & security (new, for 3B/3C).** Strict tenant isolation and authz on all
  data; account auth; **per-tenant secrets** (each client's sink URL / API keys stored
  server-side, never in another tenant's reach); **per-tenant rate-limiting of ingestion**
  (so one client's crawl can't rate-limit shared egress — the very issue we hit on
  oudfactory, now a platform-scale concern); abuse controls on "paste any URL" (scope to the
  tenant's own/authorized domains, ADR-0013).
- **Delivery security (3A).** iframe `sandbox` + `frame-ancestors`; **origin-checked**
  postMessage (never `*`); the lead-sink URL is shipped in the client-side config (inherent
  to a no-server funnel) but **no secrets/tokens are ever inlined**; XSS-safe DOM via
  `el()/escape()`; reuse the drafted GA4-inclusive CSP.
- **Output-format consistency.** One `config` is the source of truth; all three packagings
  render the same engine + config, so a fix propagates everywhere.
- **GHL integration.** Webhook → GHL inbound trigger; iframe embed on GHL pages; payload
  carries the recommended product/archetype so GHL routes/segments. CRM-agnostic.
- **Honest failure** (rule 4): sinks that can't confirm say so; publish reports the real
  artifact state; never a fabricated "published".

> **Superseded (2026-07-23, see ADR-0025):** the hosting lean below (Vercel + Postgres) is
> **withdrawn.** `fulltimedigi.com` is **already live on Netlify** (repo
> `fulltimedigi-interactive-builder`). 3C now = **edit that existing Netlify site** (keep
> the marketing homepage, add the Studio behind login), server-side generation → **Netlify
> Functions**, accounts + published funnels → **evaluate Netlify DB + Blobs first**. The
> question below is kept for history only.

## Open question for the operator (defer until 3C — does NOT block 3A/3B core)

**Platform stack/hosting** (re-opened per the SaaS vision — needs *app* hosting + a DB +
a CDN, not just static):

- **Vercel + a managed Postgres (e.g. Supabase/Neon)** — *preliminary recommendation*:
  first-class Node/serverless + static/CDN for the funnels + easy custom domains; fits a
  Studio UI cleanly.
- **Supabase-centric** (Postgres + Auth + Storage) with a light server — strong on
  accounts/auth out of the box.
- **A Node host (Railway/Render/Fly)** + separate CDN — most control, more ops.

I'll bring a focused recommendation when we reach 3C; **3A is host-agnostic** and starts now,
and 3B's authoring engine is host-agnostic too.

## Consequences

- Build the artifact producers (3A) before the platform that publishes them; nothing blocked.
- Because authoring is deterministic code, the SaaS generates funnels itself — no per-client
  AI cost — which is the platform's core economic advantage.
- The embed-at-top-of-site hero format lands early (no bundler); the platform (accounts +
  server-side generation + publish) is a thin, tested layer over the proven authoring core.
