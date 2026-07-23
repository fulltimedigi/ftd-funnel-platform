/**
 * authoring/ingest/index.js — Catalog ingestion orchestrator (ADR-0013).
 * ---------------------------------------------------------------------------
 * brand URL → a verified catalog of real products with real URLs. Ties the
 * Stage 1 pieces together behind the compliance gate:
 *   authorize (own-client only) → robots.txt → Shopify products.json →
 *   JSON-LD on the start page → sitemap-discovered product pages → assemble.
 *
 * Every network read goes through the polite fetcher; every path is checked
 * against robots.txt; the catalog assembler enforces provenance (no product
 * without a real URL) and reports coverage honestly. Never throws, never
 * fabricates. The fetcher is injectable, so `npm test` runs fully offline.
 */

import { createFetcher, DEFAULT_USER_AGENT } from "./fetcher.js";
import { parseRobots, isAllowed, crawlDelay, sitemaps as robotsSitemaps } from "./robots.js";
import { productsFromJsonLd } from "./jsonld.js";
import { productsFromShopifyJson, looksLikeShopify, productsJsonUrl } from "./shopify.js";
import { parseSitemap, looksLikeProductUrl, looksLikeProductSitemap } from "./sitemap.js";
import { buildCatalog } from "./catalog.js";

/**
 * @param {string} startUrl - the brand URL to ingest (the client's own site)
 * @param {Object} opts
 * @param {boolean} opts.authorized - REQUIRED true: operator confirms authorization
 * @param {Function} [opts.fetch] [opts.sleep] [opts.now] - injected for offline tests
 * @param {number} [opts.maxShopifyPages=5] [opts.maxSitemaps=10] [opts.maxProductPages=50]
 * @returns {Promise<{ok:boolean, reason?:string, products:Array, report:Object|null, notes:string[]}>}
 */
export async function ingestCatalog(startUrl, opts = {}) {
  const notes = [];

  // 1. Authorization gate — scope is authorized / own-client sites only (ADR-0013).
  if (opts.authorized !== true) {
    return {
      ok: false, reason: "not-authorized", products: [], report: null,
      notes: ["Ingestion refused: scope is authorized/own-client sites only. Pass { authorized: true } to confirm you have the site owner's permission."],
    };
  }
  let origin;
  try { origin = new URL(startUrl).origin; } catch {
    return { ok: false, reason: "bad-url", products: [], report: null, notes: ["Invalid start URL."] };
  }

  const fetcher = opts.fetcher || createFetcher({
    fetch: opts.fetch, sleep: opts.sleep, now: opts.now, userAgent: opts.userAgent,
    minDelayMs: opts.minDelayMs, maxPages: opts.maxPages, timeoutMs: opts.timeoutMs,
  });
  const ua = fetcher.userAgent || DEFAULT_USER_AGENT;
  const maxProductPages = opts.maxProductPages ?? 50;
  const lists = [];

  // 1b. Resolve the CANONICAL origin by following the start URL's redirect
  //     (e.g. example.com → www.example.com), and keep the HTML for step 4 so
  //     we don't fetch the start page twice.
  const startRes = await fetcher.get(startUrl);
  if (startRes.ok && startRes.finalUrl) {
    try {
      const canon = new URL(startRes.finalUrl).origin;
      if (canon !== origin) { notes.push(`Canonical origin: ${canon} (redirected from ${origin}).`); origin = canon; }
    } catch { /* keep origin */ }
  }

  // 2. robots.txt — obey it for every subsequent read; adopt crawl-delay.
  let robots = parseRobots("");
  const robotsRes = await fetcher.get(origin + "/robots.txt");
  if (robotsRes.ok && robotsRes.text) {
    robots = parseRobots(robotsRes.text);
    const cd = crawlDelay(robots, ua);
    if (cd != null) fetcher.setMinDelay(Math.max(fetcher.stats().minDelayMs, cd * 1000));
    notes.push("robots.txt loaded.");
  } else {
    notes.push("No robots.txt found — proceeding (allow all).");
  }
  const allow = (u) => isAllowed(robots, ua, u);

  // 3. Shopify products.json (paginated, best-first structured source).
  let shopifyGot = 0;
  if (allow(productsJsonUrl(origin))) {
    for (let page = 1; page <= (opts.maxShopifyPages ?? 5); page++) {
      const u = productsJsonUrl(origin, page);
      if (!allow(u)) break;
      const r = await fetcher.get(u);
      if (!r.ok || !looksLikeShopify(r.text)) break;
      const ps = productsFromShopifyJson(r.text, origin, opts.currency || null);
      if (ps.length === 0) break;
      lists.push(ps); shopifyGot += ps.length;
      if (ps.length < 250) break; // reached the last page
    }
    if (shopifyGot) notes.push(`Shopify products.json: ${shopifyGot} product(s).`);
  }

  // 4. JSON-LD on the start page (reuse the fetch from step 1b — no double GET).
  if (startRes.ok && startRes.text && allow(startRes.finalUrl || startUrl)) {
    const ps = productsFromJsonLd(startRes.text, startRes.finalUrl || startUrl);
    if (ps.length) { lists.push(ps); notes.push(`JSON-LD on start page: ${ps.length}.`); }
  }

  // 5. Sitemap discovery → product pages → JSON-LD (skipped if Shopify already delivered).
  if (shopifyGot > 0) {
    notes.push("Structured catalog found — skipping sitemap crawl (politeness).");
  } else {
    const queue = [...new Set([...robotsSitemaps(robots), origin + "/sitemap.xml"])];
    const seenSm = new Set();
    const productUrls = [];
    while (queue.length && seenSm.size < (opts.maxSitemaps ?? 10)) {
      const su = queue.shift();
      if (seenSm.has(su) || !allow(su)) continue;
      seenSm.add(su);
      const r = await fetcher.get(su);
      if (!r.ok || !r.text) continue;
      const parsed = parseSitemap(r.text);
      for (const child of parsed.sitemaps) { if (looksLikeProductSitemap(child)) queue.unshift(child); else queue.push(child); }
      for (const u of parsed.urls) if (looksLikeProductUrl(u)) productUrls.push(u);
    }
    let fetched = 0;
    for (const u of productUrls) {
      if (fetched >= maxProductPages) {
        notes.push(`Product-page cap (${maxProductPages}) reached; ${productUrls.length - fetched} URL(s) not fetched.`);
        break;
      }
      if (!allow(u)) continue;
      const r = await fetcher.get(u);
      if (!r.ok || !r.text) continue;
      const ps = productsFromJsonLd(r.text, r.finalUrl || u);
      if (ps.length) lists.push(ps);
      fetched++;
    }
    if (fetched) notes.push(`Fetched ${fetched} product page(s) via sitemap.`);
    else if (productUrls.length === 0) notes.push("No product URLs discovered via sitemap.");
  }

  // 6. Assemble + honest coverage report.
  const { products, report } = buildCatalog(lists, { thinThreshold: opts.thinThreshold });
  report.fetchStats = fetcher.stats();
  if (products.length === 0) notes.push("No products extracted — a vertical template fallback is required (no fabrication).");
  else if (report.thin) notes.push(`Thin catalog (${products.length}) — recommend a vertical template fallback.`);

  return { ok: true, brandUrl: startUrl, origin, products, report, notes };
}
