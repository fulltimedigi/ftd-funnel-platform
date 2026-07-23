# ADR-0019 — Stage 3 (Platform & Delivery): plan and build order

- **Status:** Proposed (awaiting operator approval — no code until approved)
- **Date:** 2026-07-23
- **Scope:** Stage 3. Binding inputs: `docs/PRODUCT_DECISIONS.md`, `docs/ROADMAP.md`.

## Context

Stages 0–2 are merged and live-proven: a brand URL → a real catalog → a fact-based,
trust-and-anti-bland-passing funnel `config`. Stage 3 is **delivery** — turning that config
into something a client actually runs, integrates, and that we host at **fulltimedigi.com**.
`docs/PRODUCT_DECISIONS.md` (binding) fixes the product shape:

- **One `config`, three packagings:** hosted page (URL) · **embed** (iframe/one line — the
  hero "top of the client's site" format) · single self-contained HTML file (portability).
- **Lead destination = a configurable sink with a rich payload** (email + answers +
  recommended real product + archetype + score). Default Sheets-via-AppsScript already
  exists; the **universal Webhook sink** is the 80/20 that unlocks **GHL, Zapier, Make, and
  most CRMs at once**.
- **Integrate, don't compete:** we are the smart diagnostic front-end that *feeds* GHL/CRMs
  (webhook in, iframe embed on their pages), never a CRM.

Today's delivery is only the `examples/<name>/index.html` shell (ES-module engine + fetched
config). No webhook sink, no embed, no single-file, no publish path.

## Decision (proposed) — build order and why

**3A — Delivery layer (build FIRST).** Both Studio-publish (3B) and public hosting (3C)
*consume* these artifacts, so the artifact producers come first. Each piece is self-
contained and **offline-testable** (pure transforms + injected transports), matching our
discipline. Sub-order, by value ÷ risk:

1. **Webhook sink** (`analytics/webhook-sink.js`) — *first.* Smallest, highest leverage:
   one sink → GHL/Zapier/Make/CRMs. Mirrors the proven `sheets-sink.js` pattern
   (`registerSink` + honest failure, never fakes success), carrying the **rich payload**.
   Pure, injected-`fetch`, fully offline-testable. Unblocks all integrations immediately.
2. **Hosted page + Embed** — the stated *hero* format. A generic config-URL-driven funnel
   page (parameterized `templates/index.html`) + a one-line **`embed.js`** that drops an
   **auto-resizing sandboxed iframe** into the client's own site (postMessage height, origin-
   checked). **No bundler needed** — robust and shippable early; this is "a strong lead at
   the top of the page" and how we embed inside GHL.
3. **Single self-contained HTML file** — portability/hand-off. A small dependency-free
   **inliner** (engine modules + config + CSS → one `.html` that runs anywhere, no fetch).
   Deferred to *after* 1–2 and given **its own ADR**, because inlining the ES-module graph
   is the one genuinely fiddly piece — we won't rush it or pull in a bundler dependency
   without a documented decision.

**3B — Wire into FTD Studio.** Studio is a **separate repo** (operator-facing UI). Here we
expose a clean **publish API**: `generateFunnelFromUrl()` already produces the config +
gate results; add a `publish(config, {format})` that emits the chosen packaging + registers
the sink. Studio calls: paste URL → generate → **review (show gates + preview)** → approve →
**publish**. The optional up-front **business goal** input (PRODUCT_DECISIONS §1) and the
**refine panel** (edit the AI draft, never a blank form) are surfaced by Studio and passed
through to authoring.

**3C — Ship to fulltimedigi.com.** Static hosting (Netlify/Vercel per `docs/DEPLOY.md`) of
the hosted pages + `embed.js` + the shared engine/CSS, behind the production **CSP**
(already drafted, GA4-inclusive). Custom domain + per-client funnel URLs. Needs a couple of
**operator hand-actions** (domain DNS, hosting account) — I'll make them turnkey /
click-by-click.

## First concrete build (on approval): the Webhook sink

Because it is the smallest, highest-leverage, lowest-risk piece, it unblocks the whole
integration story, and it's fully offline-testable — a clean first win, exactly like the
error-monitor was for Stage 0.

## Key considerations (called out up front)

- **Security.**
  - *Embed/iframe:* `sandbox` the iframe; set `frame-ancestors` so only intended hosts can
    embed; **origin-check every postMessage** (height/lead events) — never `*`.
  - *Lead-sink URL is shipped in the client-side config* (inherent to any no-server funnel).
    A webhook URL is low-sensitivity but spammable → recommend a validating endpoint; we only
    ever POST a well-formed lead payload; **no secrets/tokens** are ever inlined.
  - *XSS:* the engine already builds DOM via `el()/escape()`; the config we ship is our own
    generated output. Single-file inlines only that trusted config — still escaped at render.
  - *CSP:* reuse the drafted production policy (GA4 + Apps Script + fonts) for hosted/embed.
- **Output-format consistency.** One `config` is the single source of truth; all three
  formats render the *same* engine + config, so a fix propagates everywhere. Hosted =
  engine-from-host + config; embed = iframe of hosted; single-file = all inlined.
- **GHL integration.** Webhook → GHL inbound trigger; iframe embed on GHL pages; the payload
  carries the **recommended product / archetype** so GHL can route/segment (e.g. "luxury
  oud" vs "gift"). CRM-agnostic; native connectors only if a channel gets large.
- **Honest failure everywhere** (rule 4): a sink that can't confirm delivery says so; a
  publish step reports the real artifact state; no fabricated "published".

## Consequences

- We build the artifact producers before the things that consume them, so nothing is
  blocked, and each step ships offline-tested value.
- The **embed-at-top-of-site** hero format lands early (no bundler dependency); the trickier
  single-file gets its own careful step.
- The webhook makes us instantly integrable with the platforms clients already use (GHL et
  al.) without becoming a CRM — the stated strategy.
- Studio and the public domain are thin layers over a solid, tested delivery core.

## Open question for the operator (one)

**Hosting choice for fulltimedigi.com (3C):** **Netlify** (recommended — simplest static +
`_headers` CSP + instant rollbacks, matches `docs/DEPLOY.md`) or **Vercel**? Both are fine;
this only sets where we point the domain. Everything in 3A/3B is host-agnostic and starts
the same either way.
