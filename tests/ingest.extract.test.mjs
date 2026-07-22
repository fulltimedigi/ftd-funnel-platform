/**
 * tests/ingest.extract.test.mjs — Stage 1 extractors (ADR-0013).
 *
 * JSON-LD (schema.org/Product) + Shopify products.json → canonical products, plus
 * the product utils (price parsing, provenance rule). Offline, fixture-driven.
 */

import assert from "node:assert/strict";

const { parsePrice, stripTags, makeProduct, isUsableProduct } = await import("../authoring/ingest/product.js");
const { productsFromJsonLd, extractJsonLd } = await import("../authoring/ingest/jsonld.js");
const { productsFromShopifyJson, looksLikeShopify, productsJsonUrl } = await import("../authoring/ingest/shopify.js");

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

const JSONLD_PAGE = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Blue Shirt","description":"<b>Nice</b> cotton tee","sku":"BS-1","brand":{"@type":"Brand","name":"Acme"},"image":["https://img.example/1.jpg","https://img.example/2.jpg"],"offers":{"@type":"Offer","price":"29.99","priceCurrency":"USD","url":"https://shop.example/products/blue-shirt"}}
</script>
<script type="application/ld+json">{ this is : not json }</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Acme Inc"}
</script>
</head><body>x</body></html>`;

const GRAPH_PAGE = `<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"p"},{"@type":"Product","name":"Graph Prod","offers":[{"@type":"Offer","price":10,"priceCurrency":"EUR"}]}]}
</script>`;

const SHOPIFY_JSON = JSON.stringify({
  products: [
    { id: 1, title: "Oud Oil", handle: "oud-oil", body_html: "<p>Heavy <b>oud</b></p>", vendor: "ASQ", product_type: "Perfume", tags: ["مجلس", "ثقيل"], images: [{ src: "https://img/oud.jpg" }], variants: [{ price: "45.00", sku: "OUD-1" }] },
    { id: 2, title: "No Handle", body_html: "", variants: [{ price: "1" }] }, // missing handle → skipped
  ],
});

await (async () => {
  console.log("\nproduct utils:");
  await check("parsePrice handles numbers, currency symbols, and separators", () => {
    assert.equal(parsePrice(12), 12);
    assert.equal(parsePrice("12.00"), 12);
    assert.equal(parsePrice("$1,299.99"), 1299.99);
    assert.equal(parsePrice("1.299,50"), 1299.5);
    assert.equal(parsePrice("45.00 د.ك"), 45);
    assert.equal(parsePrice("free"), null);
    assert.equal(parsePrice(null), null);
  });
  await check("stripTags + provenance rule (isUsableProduct needs name + http url)", () => {
    assert.equal(stripTags("<p>a <b>b</b></p>"), "a b");
    assert.equal(isUsableProduct(makeProduct({ name: "X", url: "https://a/p" })), true);
    assert.equal(isUsableProduct(makeProduct({ name: "X", url: "" })), false);   // no URL → not usable
    assert.equal(isUsableProduct(makeProduct({ name: "", url: "https://a/p" })), false);
    assert.equal(isUsableProduct(makeProduct({ name: "X", url: "/relative" })), false); // must be absolute http
  });

  console.log("\nJSON-LD extraction:");
  await check("extracts a Product with price, currency, sku, brand, image, url", () => {
    const ps = productsFromJsonLd(JSONLD_PAGE, "https://shop.example/products/blue-shirt");
    assert.equal(ps.length, 1); // Organization ignored, malformed skipped
    const p = ps[0];
    assert.equal(p.name, "Blue Shirt");
    assert.equal(p.description, "Nice cotton tee"); // HTML stripped
    assert.equal(p.price, 29.99);
    assert.equal(p.currency, "USD");
    assert.equal(p.sku, "BS-1");
    assert.equal(p.brand, "Acme");
    assert.equal(p.image, "https://img.example/1.jpg"); // first image
    assert.equal(p.url, "https://shop.example/products/blue-shirt");
    assert.equal(p.method, "json-ld");
    assert.ok(p.confidence >= 0.9);
  });
  await check("a malformed JSON-LD block never throws (skipped)", () => {
    assert.doesNotThrow(() => extractJsonLd(JSONLD_PAGE));
    assert.equal(extractJsonLd(JSONLD_PAGE).length, 2); // 2 valid, 1 malformed skipped
  });
  await check("finds a Product inside @graph, offers-as-array, url falls back to pageUrl", () => {
    const ps = productsFromJsonLd(GRAPH_PAGE, "https://shop.example/p/graph");
    assert.equal(ps.length, 1);
    assert.equal(ps[0].name, "Graph Prod");
    assert.equal(ps[0].price, 10);
    assert.equal(ps[0].currency, "EUR");
    assert.equal(ps[0].url, "https://shop.example/p/graph"); // no offer url → page url
  });
  await check("a page with no Product JSON-LD yields nothing (no fabrication)", () => {
    assert.deepEqual(productsFromJsonLd("<html><body>no data</body></html>", "https://x/"), []);
  });

  console.log("\nShopify products.json:");
  await check("looksLikeShopify + productsJsonUrl", () => {
    assert.equal(looksLikeShopify(SHOPIFY_JSON), true);
    assert.equal(looksLikeShopify('{"foo":1}'), false);
    assert.equal(productsJsonUrl("https://asq.example/"), "https://asq.example/products.json?limit=250&page=1");
    assert.equal(productsJsonUrl("https://asq.example", 3, 100), "https://asq.example/products.json?limit=100&page=3");
  });
  await check("maps products to canonical records with REAL product URLs", () => {
    const ps = productsFromShopifyJson(SHOPIFY_JSON, "https://asq.example");
    assert.equal(ps.length, 1); // the handle-less product is skipped
    const p = ps[0];
    assert.equal(p.name, "Oud Oil");
    assert.equal(p.description, "Heavy oud");
    assert.equal(p.price, 45);
    assert.equal(p.url, "https://asq.example/products/oud-oil");
    assert.equal(p.image, "https://img/oud.jpg");
    assert.equal(p.brand, "ASQ");
    assert.deepEqual(p.differentiators, ["مجلس", "ثقيل"]);
    assert.equal(p.attributes.type, "Perfume");
    assert.equal(p.sku, "OUD-1");
    assert.equal(p.method, "shopify");
    assert.ok(isUsableProduct(p));
  });
  await check("malformed JSON → [] (honest, no throw)", () => {
    assert.deepEqual(productsFromShopifyJson("{bad", "https://x"), []);
  });

  if (process.exitCode === 1) console.error("\nFAIL — ingest extract tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} ingest-extract assertions passed.\n`);
})();
