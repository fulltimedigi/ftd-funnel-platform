# Catalog Ingestion (Stage 1)

**brand URL → a verified catalog of real products with real URLs.** The moat: no
competitor takes an arbitrary brand URL and reads the real catalog. Decision + rationale:
`docs/adr/0013-stage1-catalog-ingestion-approach.md`.

## Run it

```
npm run ingest -- https://your-client-site.com  catalog.json
```

Writes `catalog.json` (`{ brandUrl, origin, report, products[] }`) and prints an honest
coverage report. Exit codes: `0` products found · `2` ran but empty/thin · `1` refused /
bad URL.

> **Scope (ADR-0013): authorized / own-client sites only.** Only run this against a site
> you have the owner's permission to ingest — your client's, as part of the engagement.
> Providing the URL asserts that authorization. The pipeline refuses unless
> `{ authorized: true }` is passed (the CLI passes it for you).

## What it does (best-first, behind a compliance gate)

1. **Authorize** — own-client scope only.
2. **robots.txt (RFC 9309)** — obeyed for every path; `crawl-delay` adopted; `Sitemap:` read.
3. **Shopify `/products.json`** — clean structured data when present (paginated).
4. **JSON-LD `schema.org/Product`** — on the start page and on discovered product pages.
5. **Sitemaps** — `sitemap.xml` (+ index) to discover product URLs, then extract each.
6. **Assemble** — dedupe by URL, **enforce provenance** (a product with no real URL is
   dropped, never invented), and report coverage + a **thin** flag.

Politeness: identifies itself (`FullTimeDigiBot/1.0`), rate-limits, caps total pages,
times out, and **fails honestly** — it never reports products it didn't verify. Product
data only; never personal data.

## Output shape (per product)

```json
{
  "name": "…", "description": "…", "price": 29.99, "currency": "USD",
  "url": "https://site/products/x",       // real, verified — the provenance
  "image": "https://…", "sku": "…", "brand": "…",
  "attributes": { "type": "…" }, "differentiators": ["…"],
  "sourceUrl": "https://…", "method": "shopify|json-ld", "confidence": 0.95
}
```

## Thin / empty sites

If a site exposes no structured data, the report flags `thin: true` (or 0 products) and
recommends a **vertical-template fallback** rather than fabricating inventory — consistent
with the no-fabrication law. The template fallback itself is built with the Stage 2
authoring work.

## Tests

Fully offline (`fetch`/`sleep`/`now` injected, fixtures): `tests/ingest.compliance.test.mjs`,
`tests/ingest.extract.test.mjs`, `tests/ingest.pipeline.test.mjs`. A live smoke test is run
manually against an operator-authorized site.
