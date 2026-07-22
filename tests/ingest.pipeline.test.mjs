/**
 * tests/ingest.pipeline.test.mjs — Stage 1 sitemap + catalog + orchestrator (ADR-0013).
 *
 * Unit: sitemap parsing + catalog assembly (dedupe, provenance drop, thin flag).
 * Integration: ingestCatalog end-to-end against a fake fetch routed to fixtures —
 * authorization gate, Shopify path, JSON-LD + sitemap path, and robots.txt
 * enforcement. Fully offline (fetch/sleep/now injected). Exits non-zero on fail.
 */

import assert from "node:assert/strict";

const { parseSitemap, looksLikeProductUrl } = await import("../authoring/ingest/sitemap.js");
const { buildCatalog } = await import("../authoring/ingest/catalog.js");
const { makeProduct } = await import("../authoring/ingest/product.js");
const { ingestCatalog } = await import("../authoring/ingest/index.js");

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

/* -------- fake fetch router: exact-URL → fixture, else 404. Records calls. -- */
function router(routes, calls) {
  return async (url) => {
    if (calls) calls.push(url);
    const r = routes[url];
    if (!r) return { ok: false, status: 404, url, headers: { get: () => "" }, text: async () => "404" };
    const status = r.status || 200;
    return { ok: status < 400, status, url: r.finalUrl || url, headers: { get: () => r.ct || "text/html" }, text: async () => r.body };
  };
}
const OFFLINE = { authorized: true, sleep: async () => {}, now: () => 0, minDelayMs: 0 };
const pdp = (name, url, price) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name, offers: { "@type": "Offer", price: String(price), priceCurrency: "USD", url } })}</script></head></html>`;

await (async () => {
  console.log("\nsitemap parsing:");
  await check("distinguishes <sitemapindex> from <urlset>; product-URL heuristic", () => {
    const idx = parseSitemap(`<sitemapindex><sitemap><loc>https://s/a.xml</loc></sitemap></sitemapindex>`);
    assert.deepEqual(idx.sitemaps, ["https://s/a.xml"]);
    assert.deepEqual(idx.urls, []);
    const set = parseSitemap(`<urlset><url><loc>https://s/products/x</loc></url><url><loc>https://s/pages/about</loc></url></urlset>`);
    assert.deepEqual(set.urls, ["https://s/products/x", "https://s/pages/about"]);
    assert.equal(looksLikeProductUrl("https://s/products/x"), true);
    assert.equal(looksLikeProductUrl("https://s/pages/about"), false);
  });

  console.log("\ncatalog assembly (dedupe, provenance, thin):");
  await check("drops products with no real URL; dedupes by URL; back-fills fields", () => {
    const a = makeProduct({ name: "P", url: "https://x/products/p", method: "json-ld", confidence: 0.9 }); // no price
    const b = makeProduct({ name: "P", url: "https://x/products/p?variant=2", price: "10", currency: "USD", method: "shopify", confidence: 0.95 });
    const bad = makeProduct({ name: "No URL", url: "" });
    const { products, report } = buildCatalog([[a], [b, bad]]);
    assert.equal(products.length, 1, "a and b are the same product URL");
    assert.equal(products[0].price, 10, "price back-filled/kept from the higher-confidence dup");
    assert.equal(report.dropped, 1, "the URL-less product dropped");
    assert.equal(report.usable, 1);
    assert.equal(report.thin, true, "1 < threshold 3");
  });

  console.log("\ningest — authorization gate:");
  await check("refuses without { authorized:true } and makes no request", async () => {
    const calls = [];
    const res = await ingestCatalog("https://shop.example", { authorized: false, fetch: router({}, calls), sleep: async () => {}, now: () => 0 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "not-authorized");
    assert.equal(calls.length, 0, "no network before authorization");
  });

  console.log("\ningest — Shopify path:");
  await check("reads products.json, stops at the short last page, skips the sitemap", async () => {
    const SHOPIFY = JSON.stringify({ products: [
      { id: 1, title: "P1", handle: "p1", vendor: "V", product_type: "T", tags: ["a"], images: [{ src: "https://i/1" }], variants: [{ price: "10.00", sku: "S1" }] },
      { id: 2, title: "P2", handle: "p2", variants: [{ price: "20" }] },
      { id: 3, title: "P3", handle: "p3", variants: [{ price: "30" }] },
    ] });
    const calls = [];
    const routes = {
      "https://shop.example/robots.txt": { body: "User-agent: *\nAllow: /\nSitemap: https://shop.example/sitemap.xml" },
      "https://shop.example/products.json?limit=250&page=1": { body: SHOPIFY, ct: "application/json" },
      "https://shop.example/": { body: "<html><body>home</body></html>" },
    };
    const res = await ingestCatalog("https://shop.example/", { ...OFFLINE, fetch: router(routes, calls) });
    assert.equal(res.ok, true);
    assert.equal(res.products.length, 3);
    assert.equal(res.report.byMethod.shopify, 3);
    assert.equal(res.report.thin, false);
    assert.equal(res.report.withPrice, 3);
    assert.ok(!calls.includes("https://shop.example/products.json?limit=250&page=2"), "no page 2 after a short page");
    assert.ok(res.notes.some((n) => /skipping sitemap/i.test(n)));
    assert.ok(res.products.every((p) => /^https:\/\/shop\.example\/products\//.test(p.url)), "real product URLs");
  });

  console.log("\ningest — JSON-LD + sitemap path, with dedupe across methods:");
  await check("start-page + sitemap product pages merge and dedupe", async () => {
    const routes = {
      "https://jl.example/robots.txt": { body: "User-agent: *\nDisallow:" },
      "https://jl.example/products.json?limit=250&page=1": { status: 404, body: "no" }, // not Shopify
      "https://jl.example/": { body: pdp("Prod A", "https://jl.example/products/a", 11) },
      "https://jl.example/sitemap.xml": { body: `<sitemapindex><sitemap><loc>https://jl.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>`, ct: "application/xml" },
      "https://jl.example/sitemap_products_1.xml": { body: `<urlset><url><loc>https://jl.example/products/a</loc></url><url><loc>https://jl.example/products/b</loc></url><url><loc>https://jl.example/products/c</loc></url><url><loc>https://jl.example/pages/about</loc></url></urlset>`, ct: "application/xml" },
      "https://jl.example/products/a": { body: pdp("Prod A", "https://jl.example/products/a", 11) },
      "https://jl.example/products/b": { body: pdp("Prod B", "https://jl.example/products/b", 22) },
      "https://jl.example/products/c": { body: pdp("Prod C", "https://jl.example/products/c", 33) },
    };
    const calls = [];
    const res = await ingestCatalog("https://jl.example/", { ...OFFLINE, fetch: router(routes, calls) });
    assert.equal(res.ok, true);
    const names = res.products.map((p) => p.name).sort();
    assert.deepEqual(names, ["Prod A", "Prod B", "Prod C"], "A deduped across start-page + sitemap");
    assert.equal(res.report.byMethod["json-ld"], 3);
    assert.ok(!calls.includes("https://jl.example/pages/about"), "non-product URL not fetched");
    assert.equal(res.report.thin, false);
  });

  console.log("\ningest — robots.txt is enforced:");
  await check("Disallow: /products.json means products.json is never requested", async () => {
    const routes = {
      "https://blocked.example/robots.txt": { body: "User-agent: *\nDisallow: /products.json" },
      "https://blocked.example/": { body: pdp("Only", "https://blocked.example/products/only", 5) },
      "https://blocked.example/sitemap.xml": { status: 404, body: "no" },
    };
    const calls = [];
    const res = await ingestCatalog("https://blocked.example/", { ...OFFLINE, fetch: router(routes, calls) });
    assert.ok(!calls.some((u) => u.includes("/products.json")), "robots.txt Disallow honored");
    assert.equal(res.ok, true);
    assert.equal(res.products.length, 1); // still got the start-page JSON-LD product
  });

  console.log("\ningest — empty site is honest (no fabrication):");
  await check("a site with nothing structured returns 0 products + a template-fallback note", async () => {
    const routes = {
      "https://bare.example/robots.txt": { status: 404, body: "no" },
      "https://bare.example/": { body: "<html><body>just text, no data</body></html>" },
      "https://bare.example/sitemap.xml": { status: 404, body: "no" },
    };
    const res = await ingestCatalog("https://bare.example/", { ...OFFLINE, fetch: router(routes, {}) });
    assert.equal(res.ok, true);
    assert.equal(res.products.length, 0);
    assert.ok(res.notes.some((n) => /vertical template fallback/i.test(n)));
  });

  if (process.exitCode === 1) console.error("\nFAIL — ingest pipeline tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} ingest-pipeline assertions passed.\n`);
})();
