# ADR-0013 — Stage 1 catalog ingestion: layered extraction + compliance-first

- **Status:** Proposed (awaiting operator approval — no code until approved)
- **Date:** 2026-07-22

## Context

Stage 1 is the competitive moat (`docs/COMPETITIVE_ANALYSIS.md`): **brand URL → a
structured, real product catalog** — the capability no competitor has generally. The
authoring layer (`docs/ARCHITECTURE.md`, Layer 3) turns that catalog into a grounded
funnel in Stage 2, so ingestion quality is the foundation of the whole "recommend real
products with real reasons" promise. Roadmap exit: *paste a real brand URL → a verified
catalog JSON with real product URLs*, with provenance so **nothing is fabricated** (the
same discipline the trust gate enforces).

Reading another party's website programmatically has a **legal dimension** that must be
settled before any code — this ADR records both the extraction approach and the
compliance posture.

## Research — legal landscape (2025–2026)

- **Public data & CFAA:** *hiQ v. LinkedIn* (9th Cir.) established that accessing
  **publicly available** data (no login) does not, by itself, violate the US CFAA.
  However, hiQ **ultimately lost on breach-of-contract** (Terms of Service), and
  *Meta v. Bright Data* keeps contract-based claims alive. → Public ≠ unconditionally free;
  ToS still matter.
- **robots.txt is now a standard:** RFC 9309 (IETF, Sept 2022) formalizes the Robots
  Exclusion Protocol. It is not universally "legally binding," but regulators treat
  compliance as good-faith evidence (France's CNIL weighs it in legitimate-interest
  assessments). `crawl-delay` is **not** in RFC 9309 (a de-facto extension) but we honor
  it when present.
- **Personal data is the real hazard:** scraping *personal* data draws the large fines
  (Clearview €30.5M NL / €20M IT; KASPR €240K FR under GDPR). Product catalogs
  (names/prices/product URLs) are **not** personal data.

## Research — extraction methods (best-first)

1. **Structured data — JSON-LD `schema.org/Product`/`Offer`** embedded in
   `<script type="application/ld+json">`. Google's recommended format; highest precision,
   lowest effort; carries name, description, price, currency, sku, image, url. Also
   OpenGraph `product:` tags / microdata as secondary signals.
2. **Platform-native JSON** — Shopify exposes a public `/products.json`
   (`?limit=250&page=N`) and `/collections/<handle>/products.json`; WooCommerce exposes a
   Store API (`/wp-json/wc/store/v1/products`). Clean, structured, no HTML parsing.
3. **Sitemaps** — `/robots.txt` → `Sitemap:` and `/sitemap.xml` (+ sitemap index; Shopify
   ships `sitemap_products_*.xml`) to **discover** product URLs, then extract each page's
   JSON-LD.
4. **HTML heuristics** — fallback selectors/patterns for sites with no structured data.
5. **LLM extraction** — last resort for unstructured/thin sites: feed cleaned HTML to a
   model to extract fields — **only with provenance and never inventing values**.

## Options considered

1. **One generic HTML scraper + LLM for everything.** Rejected: lower precision, more
   fabrication risk, heavier, and wasteful when structured data exists.
2. **Shopify-only (like Octane/Quizell).** Rejected: that is exactly the competitor
   limitation we are beating; the moat is *arbitrary* brand URLs.
3. **Layered best-first extraction behind a compliance gate, provenance-required, no
   personal data, dependency-free first cut, LLM fallback deferred to its own ADR.**
   Chosen.

## Decision (proposed)

**Option 3**, built under `authoring/ingest/` (net-new; the runtime is untouched).

**A. Compliance-first (the gate every fetch passes):**
- **Authorization posture:** the tool ingests the **client's own site as part of a paid
  engagement** — i.e. with the site owner's authorization. This removes the ToS/contract
  risk that sank hiQ (you don't breach your own client's terms) and is the intended
  operating model. Ingesting arbitrary third-party sites is **out of scope** unless the
  operator explicitly authorizes a domain. (This is the one decision surfaced to the
  operator.)
- **robots.txt (RFC 9309):** fetch + parse it; obey `Disallow` for our user-agent; read
  `Sitemap:`; honor `crawl-delay` when present, else a polite default (≈1–2s).
- **Identify + be gentle:** a clear User-Agent (`FullTimeDigiBot/1.0
  (+https://fulltimedigi.com/bot)`), low concurrency, a total-page cap, and timeouts —
  "must not interfere with the regular operation of a site" (RFC 9309).
- **Product data only:** never extract personal/customer data (avoids the GDPR hazard).

**B. Extraction pipeline (best-first, each with provenance):** JSON-LD → platform JSON
(Shopify/WooCommerce) → sitemap-discovered pages → (HTML heuristics / LLM as later,
separately-ADR'd fallbacks). Each product is normalized to
`{ name, attributes, price, currency, url, image, differentiators, sourceUrl, method,
confidence }`.

**C. Provenance = no fabrication:** a product **renders only if it has a real, fetched
URL**; missing fields stay empty, never guessed. Output a **coverage + confidence
report** (count, method mix, gaps) and a **thin-site** flag that routes to a vertical
template rather than inventing inventory.

**D. Zero-dependency first cut, testable offline:** JSON-LD, Shopify JSON, and sitemap
parsing are done with built-in `fetch` + small parsers — no new dependencies (preserving
ADR-0004's ethos). The fetcher is **injected**, so `npm test` runs fully offline against
saved fixtures (a real HTML+JSON-LD snippet, a `products.json` sample, a `sitemap.xml`, a
`robots.txt`); a single live smoke test runs only against an operator-authorized site.
Any future need for an HTML-parser dependency or the LLM extractor gets its **own ADR**
(consistent with ADR-0004's carve-out for the authoring layer).

## Consequences

- The moat is built on **structured, verifiable** data first, so most real stores extract
  cleanly and precisely, and every product carries a real URL for Stage 2 to recommend.
- We operate inside a defensible legal posture: authorized (own-client) ingestion,
  robots.txt-respecting, product-data-only, identified and rate-limited.
- Honest coverage: thin or blocked sites yield a truthful "partial/empty + why" report and
  a template fallback — never fabricated products (rules 3 & 4).
- Deferring HTML-heuristic/LLM extraction keeps the first increment small, dependency-free,
  and fully test-green; breadth grows in later, separately-documented steps.

## Open decision for the operator

Confirm the **ingestion scope**: (a) **client-owned/authorized sites only** (recommended —
lowest risk, matches the engagement model), or (b) also allow arbitrary third-party brand
URLs (with a per-domain authorization acknowledgment and stricter robots/ToS checks). The
build starts the same either way (compliance core first); this only sets the default
guardrail.
