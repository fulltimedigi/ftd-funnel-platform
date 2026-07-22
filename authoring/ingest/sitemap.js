/**
 * authoring/ingest/sitemap.js — Sitemap discovery (sitemaps.org protocol).
 * ---------------------------------------------------------------------------
 * Stage 1 (ADR-0013), best-first extraction #3: use sitemaps to DISCOVER product
 * page URLs, then extract each page's JSON-LD. A sitemap file is either a
 * <sitemapindex> (links to more sitemaps) or a <urlset> (page URLs).
 *
 * Dependency-free: <loc> values via regex, minimal entity decode. Pure, Node-safe.
 */

function _decode(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

/**
 * Parse a sitemap XML into { sitemaps, urls }.
 * A <sitemapindex> yields child sitemap URLs; a <urlset> yields page URLs.
 * @param {string} xml
 */
export function parseSitemap(xml) {
  if (typeof xml !== "string") return { sitemaps: [], urls: [] };
  const locs = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const u = _decode(m[1].trim());
    if (u) locs.push(u);
  }
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  return isIndex ? { sitemaps: locs, urls: [] } : { sitemaps: [], urls: locs };
}

/** Heuristic: does a URL look like a product detail page? */
export function looksLikeProductUrl(url) {
  return /\/products?\//i.test(String(url || ""));
}

/** Heuristic: does a sitemap URL look like a product sitemap (Shopify: sitemap_products_*)? */
export function looksLikeProductSitemap(url) {
  return /product/i.test(String(url || ""));
}
