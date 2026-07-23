/**
 * tests/ingest.compliance.test.mjs — Stage 1 compliance core (ADR-0013).
 *
 * Covers robots.txt (RFC 9309) parsing + Allow/Disallow matching (group select,
 * longest-match, Allow-wins ties, `*`/`$`, empty-Disallow, crawl-delay, sitemaps)
 * and the polite fetcher (identifies itself, rate-limits, caps pages, honest
 * failure). Fully offline: fetch/sleep/now are injected. Exits non-zero on fail.
 */

import assert from "node:assert/strict";

const robots = await import("../authoring/ingest/robots.js");
const { createFetcher, DEFAULT_USER_AGENT } = await import("../authoring/ingest/fetcher.js");

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

const UA = "FullTimeDigiBot";

const SAMPLE = `
# example store robots
User-agent: *
Disallow: /admin
Disallow: /cart
Allow: /admin/public
Crawl-delay: 2

User-agent: BadBot
Disallow: /

Sitemap: https://shop.example/sitemap.xml
Sitemap: https://shop.example/sitemap_products.xml
`;

await (async () => {
  console.log("\nrobots.txt parsing:");
  await check("parses groups, crawl-delay, and sitemaps", () => {
    const r = robots.parseRobots(SAMPLE);
    assert.equal(r.groups.length, 2);
    assert.deepEqual(robots.sitemaps(r), ["https://shop.example/sitemap.xml", "https://shop.example/sitemap_products.xml"]);
    assert.equal(robots.crawlDelay(r, UA), 2); // from the `*` group
  });

  console.log("\nAllow/Disallow matching:");
  const r = robots.parseRobots(SAMPLE);
  await check("disallowed paths are blocked; product paths allowed", () => {
    assert.equal(robots.isAllowed(r, UA, "/admin"), false);
    assert.equal(robots.isAllowed(r, UA, "/admin/settings"), false);
    assert.equal(robots.isAllowed(r, UA, "/cart"), false);
    assert.equal(robots.isAllowed(r, UA, "/products/blue-shirt"), true);
  });
  await check("Allow overrides a less/equally specific Disallow", () => {
    assert.equal(robots.isAllowed(r, UA, "/admin/public"), true); // Allow /admin/public beats Disallow /admin
  });
  await check("a full URL is reduced to its path", () => {
    assert.equal(robots.isAllowed(r, UA, "https://shop.example/cart?x=1"), false);
    assert.equal(robots.isAllowed(r, UA, "https://shop.example/products/x"), true);
  });
  await check("a more specific user-agent group wins over `*`", () => {
    assert.equal(robots.isAllowed(r, "BadBot", "/products/x"), false); // BadBot Disallow: /
    assert.equal(robots.isAllowed(r, UA, "/products/x"), true);
  });
  await check("empty/absent robots allows everything", () => {
    assert.equal(robots.isAllowed(robots.parseRobots(""), UA, "/anything"), true);
    assert.equal(robots.isAllowed(robots.parseRobots("User-agent: *\nDisallow:"), UA, "/x"), true);
  });
  await check("`$` end-anchor and `*` wildcard match correctly", () => {
    const r2 = robots.parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp/*");
    assert.equal(robots.isAllowed(r2, UA, "/files/a.pdf"), false);
    assert.equal(robots.isAllowed(r2, UA, "/files/a.pdf?x=1"), true); // $ anchors end → query not matched
    assert.equal(robots.isAllowed(r2, UA, "/tmp/anything/here"), false);
  });

  console.log("\npolite fetcher — identity + honest failure:");
  await check("sends our User-Agent and returns text on success", async () => {
    let seen = null;
    const f = createFetcher({
      fetch: async (url, o) => { seen = o.headers["User-Agent"]; return { ok: true, status: 200, url, headers: { get: () => "text/html" }, text: async () => "BODY:" + url }; },
      sleep: async () => {}, now: () => 0, minDelayMs: 0,
    });
    const res = await f.get("https://shop.example/products.json");
    assert.equal(res.ok, true);
    assert.equal(res.text, "BODY:https://shop.example/products.json");
    assert.equal(res.contentType, "text/html");
    assert.equal(seen, DEFAULT_USER_AGENT);
  });
  await check("network error → ok:false reason 'network' (never throws)", async () => {
    const f = createFetcher({ fetch: async () => { throw new Error("offline"); }, sleep: async () => {}, now: () => 0 });
    const res = await f.get("https://x/");
    assert.equal(res.ok, false);
    assert.equal(res.reason, "network");
  });
  await check("HTTP error surfaces status honestly", async () => {
    const f = createFetcher({ fetch: async (url) => ({ ok: false, status: 404, url, headers: { get: () => "" }, text: async () => "nope" }), sleep: async () => {}, now: () => 0 });
    const res = await f.get("https://x/missing");
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.equal(res.reason, "http-404");
  });

  console.log("\npolite fetcher — 429/503 back-off + retry:");
  await check("retries a 429 (honoring Retry-After) then succeeds", async () => {
    let n = 0; const sleeps = [];
    const f = createFetcher({
      fetch: async (url) => {
        n++;
        if (n < 3) return { ok: false, status: 429, url, headers: { get: (h) => (h === "retry-after" ? "1" : "") }, text: async () => "rate limited" };
        return { ok: true, status: 200, url, headers: { get: () => "application/json" }, text: async () => "OK" };
      },
      sleep: async (ms) => { sleeps.push(ms); }, now: () => 0, minDelayMs: 0, maxRetries: 3,
    });
    const res = await f.get("https://x/products.json");
    assert.equal(res.ok, true);
    assert.equal(res.text, "OK");
    assert.equal(n, 3, "two 429s then a 200");
    assert.deepEqual(sleeps, [1000, 1000], "waited Retry-After=1s before each retry");
    assert.equal(f.stats().requests, 1, "one logical page, not three");
  });
  await check("gives up honestly after maxRetries of 429", async () => {
    const f = createFetcher({
      fetch: async (url) => ({ ok: false, status: 429, url, headers: { get: () => "" }, text: async () => "no" }),
      sleep: async () => {}, now: () => 0, minDelayMs: 0, maxRetries: 2,
    });
    const res = await f.get("https://x/p");
    assert.equal(res.ok, false);
    assert.equal(res.reason, "http-429");
  });

  console.log("\npolite fetcher — rate limit + page cap:");
  await check("spaces requests by minDelayMs (sleeps before the 2nd request)", async () => {
    const sleeps = [];
    let t = 0;
    const f = createFetcher({
      fetch: async (url) => ({ ok: true, status: 200, url, headers: { get: () => "" }, text: async () => "x" }),
      sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t, minDelayMs: 1000,
    });
    await f.get("https://x/a");
    await f.get("https://x/b");
    assert.deepEqual(sleeps, [1000]); // no wait before the first, ~1000ms before the second
  });
  await check("stops at maxPages (cap), reporting it instead of fetching", async () => {
    let calls = 0;
    const f = createFetcher({
      fetch: async (url) => { calls++; return { ok: true, status: 200, url, headers: { get: () => "" }, text: async () => "x" }; },
      sleep: async () => {}, now: () => 0, maxPages: 2,
    });
    await f.get("https://x/1");
    await f.get("https://x/2");
    const third = await f.get("https://x/3");
    assert.equal(calls, 2);
    assert.equal(third.ok, false);
    assert.equal(third.reason, "page-cap-reached");
  });

  if (process.exitCode === 1) console.error("\nFAIL — ingest compliance tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} ingest-compliance assertions passed.\n`);
})();
