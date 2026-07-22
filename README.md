# FTD Funnel Platform

> Paste a brand's URL → an AI reads its **real catalog**, derives the decision its
> customers struggle with, authors a **trust-validated interactive funnel** that
> recommends **real products with real reasons**, and captures the lead.

This is the flagship product of FullTimeDigi — a next-generation interactive
**decision-funnel** platform. It is built to compete not just locally but with the
best funnel builders in the world (Typeform, Involve.me, Outgrow, Interact,
Heyflow, Perspective, Octane AI).

**Destination:** deploy at **fulltimedigi.com**.

---

## The one thing no competitor does

Every funnel builder on the market today falls into one of two camps:

1. **AI builds the funnel structure, but not with your real products.** (Involve.me
   says so in its own docs; same for ScoreApp, Interact.)
2. **Real-product recommendations — but only inside Shopify, and you wire the logic
   by hand.** (Octane AI, Quizell.)

**Nobody takes an arbitrary brand URL → reads the real catalog → authors a grounded
funnel that recommends real SKUs with justified reasons.** That is this platform's
wedge — and it aligns exactly with FullTimeDigi's founding laws: *real product, no
fabrication.*

See [`docs/COMPETITIVE_ANALYSIS.md`](docs/COMPETITIVE_ANALYSIS.md) for the full teardown.

---

## Architecture at a glance

Three layers (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

| Layer | Job | Origin |
|-------|-----|--------|
| **Authoring** (new) | brand URL → real catalog → decision model → funnel `config` | net-new AI layer |
| **Decision + Trust** | scoring, decision-table, signal-gated explanation, the trust gate | ported from `fulltimedigi-engine-v0` (the tested core) |
| **Runtime + Delivery** | render, state, lead capture, analytics, error monitoring, backend | merged from `ftd-diagnostic-engine` (the production runtime) |

The **operator UI** (paste a URL, review, approve, publish) lives in the separate
`ftd-studio` control panel, which drives this platform.

---

## Status

🚧 **Early build.** This repo was seeded from `fulltimedigi-engine-v0` — the only one
of the two engines with a green test suite — so we build on verified ground and merge
the production engine's strengths in **while keeping tests green at every step**.

- ✅ Foundation: v0 engine + **14 test suites (176 assertions) green**, CI-ready.
- ⬜ Stage 0 — Unified engine (merge production runtime/delivery + fix known bugs).
- ⬜ Stage 1 — Catalog ingestion (brand URL → structured real catalog).
- ⬜ Stage 2 — AI authoring (catalog → questions + scoring + grounded recommendations).
- ⬜ Stage 3 — Wire into FTD Studio + deploy to fulltimedigi.com.

Full plan: [`docs/ROADMAP.md`](docs/ROADMAP.md). Every material decision is recorded
as an ADR in [`docs/adr/`](docs/adr/).

---

## Run it

Zero build, zero dependencies (vanilla ES modules).

```bash
npm test          # run all engine test suites
npm run serve     # static server → open examples/<funnel>/index.html
```

---

## Non-negotiable quality bar

Inherited from the FTD engines and enforced in code:

- **No fabrication.** A recommendation renders only if its reason resolves from the
  user's actual answers. Every outcome maps to a **real product with a real URL**.
- **No dead ends.** The trust gate brute-forces the answer space; no combination may
  yield an empty result.
- **No unmeasured claims.** A copy linter rejects "personality / N% match / we
  guarantee" language the funnel never measured.
- **Green tests before merge.** Nothing lands that turns a suite red.
