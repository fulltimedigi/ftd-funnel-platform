# Roadmap

The product is built in stages. **Each stage ships something that works**, is
test-covered, and is preceded by research recorded in an ADR. We do not move to the
next stage until the current one is green.

---

## Stage 0 — Unified engine  ·  *foundation*

Merge the two engines into one clean, tested engine (see ADR-0003).

- [x] Seed from `fulltimedigi-engine-v0` — 14 suites / 176 assertions green.
- [x] Port production **lead capture** loop (offline outbox → POST → honest failure; retried at boot / on reconnect) — ADR-0006.
- [x] Port production **error monitor** (PII masking) — Node-safe, test-covered (ADR-0005).
- [x] Port production **analytics** (working sheets + GA4 sinks) replacing v0 stubs; lifecycle events wired in `index.js` (ADR-0007).
- [x] Port production **i18n-rtl** (Arabic numerals, LTR-forcing) replacing v0 stubs; real `rtl.css` wired into the shells (ADR-0008).
- [x] Make the **JSON schema executable** at boot (dependency-free validator; ran it, fixed the primary-vs-contextual `becauseTemplate` drift it exposed) — ADR-0009.
- [x] Build the **`personas`** result layout (strengths/gaps/next-steps; no longer falls back to tracks) — ADR-0010.
- [ ] Fix carried bugs: mount-selector restart, `track-based` mode, missing theme, GA4 CSP.
- [ ] Merge production's backend `Code.gs` (per-funnel isolation).
- **Exit:** one engine, all strengths, no known bugs, `npm test` green, one demo funnel boots & renders.

## Stage 1 — Catalog ingestion  ·  *the moat*

Brand URL → a structured, **real** product catalog. This is the capability no
competitor has generally.

- [ ] Research + ADR: crawling/extraction approach (sitemap, product-schema/JSON-LD, HTML heuristics, LLM extraction), robots/ToS compliance, rate limits.
- [ ] Extractor → normalized catalog: `{name, attributes, price, url, differentiators}` per product, with provenance (source URL) so nothing is fabricated.
- [ ] Coverage + confidence report; graceful fallback when a site is thin (vertical templates).
- **Exit:** paste a real brand URL → a verified catalog JSON with real product URLs.

## Stage 2 — AI authoring  ·  *the value*

Catalog → a complete, grounded funnel `config` the engine can run.

- [ ] Research + ADR: how to derive the 3–5 real decision axes from product differentiators; question generation (facts-not-goals); automatic answer→product scoring matrix.
- [ ] Generate config: questions, scoring, archetypes each bound to a **real SKU + URL**, `becauseTemplate` grounded in answers.
- [ ] Run the **trust gate** on generated output — no dead ends, no fabricated reasons, no unmeasured claims. Regenerate/repair on failure.
- [ ] Human-in-the-loop diffs (operator can edit questions/weights/products).
- **Exit:** URL → auto-authored funnel that passes the trust gate, recommending real products with real reasons.

## Stage 3 — Platform & deploy  ·  *the delivery*

- [ ] Wire Stages 1–2 into **FTD Studio** (paste URL → generate → review → approve → publish).
- [ ] Table-stakes to be credible globally (from the competitor analysis): native CRM/email + webhooks, hosted page + embed + custom domain, per-step analytics dashboard, A/B on questions/results, brand auto-styling from the ingested site.
- [ ] Ship to **fulltimedigi.com**.
- **Exit:** a public platform: type a brand URL, get a live funnel with real products.

---

## Definition of done (every stage)

Green tests · an ADR for each material decision · no fabricated data anywhere ·
honest failure states · documented in the relevant `docs/` file.
