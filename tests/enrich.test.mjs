/**
 * tests/enrich.test.mjs — grounded AI enrichment (ADR-0028, Track C).
 *
 * Proves the moat OFFLINE (model call injected): a canned expert "design" of rich
 * decision axes compiles — through the SAME gate-passing builder — into a deep
 * funnel of REAL products; hallucinated URLs are dropped; a thin design is
 * repaired; a hopeless one fails honestly; and generateFunnelFromUrl escalates to
 * the AI path only when the catalog justifies more.
 */

import assert from "node:assert/strict";
import { enrichAuthor, designToAxes, DESIGN_SCHEMA } from "../authoring/ai/enrichAuthor.js";
import { generateFunnelFromUrl } from "../authoring/index.js";
import { trustValidate } from "../engine/trustValidate.js";
import { antiBlandCheck } from "../authoring/author/qualityGate.js";
import { richnessCheck } from "../authoring/quality/richnessCheck.js";

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

/* ---- a synthetic catalog with real multi-dimensional structure ------------- */
// 16 products = every combination of 4 binary dimensions. url is the ground truth.
const ORIGIN = "https://brand.example";
const PRODUCTS = Array.from({ length: 16 }, (_, i) => ({
  name: "Product " + i, url: `${ORIGIN}/p/${i}`, price: 40 + i * 10, currency: "USD", attributes: {},
}));
const CATALOG = { origin: ORIGIN, products: PRODUCTS, brandUrl: ORIGIN };
const bit = (i, n) => (i >> n) & 1;

/** A RICH expert design: 4 discriminating axes, every product mapped on each. */
function richDesign() {
  const axisDefs = [
    { id: "occasion", label: "المناسبة", question: "ما المناسبة؟", n: 0, vals: ["daily", "event"] },
    { id: "sillage", label: "الثبات", question: "ما قوة الأثر المفضّلة؟", n: 1, vals: ["soft", "strong"] },
    { id: "character", label: "الطابع", question: "أي طابع تفضّل؟", n: 2, vals: ["fresh", "warm"] },
    { id: "budget", label: "الميزانية", question: "ما ميزانيتك؟", n: 3, vals: ["value", "premium"] },
  ];
  return {
    brandName: "Brand",
    axes: axisDefs.map((a) => ({
      id: a.id, label: a.label, question: a.question,
      values: a.vals.map((v) => ({ value: v, label: v })),
      productValues: PRODUCTS.map((p, i) => ({ url: p.url, value: a.vals[bit(i, a.n)] })), // array of {url,value} — matches DESIGN_SCHEMA
    })),
  };
}

/** A THIN design: only 2 axes (→ 2 questions → fails richness on this big catalog). */
function thinDesign() {
  const d = richDesign();
  return { brandName: "Brand", axes: d.axes.slice(0, 2) };
}

await (async () => {
  console.log("\nenrich — the design schema is valid for structured outputs (regression guard):");
  await check("every object sets additionalProperties:false — no dynamic-key maps (the API rejects those with 400)", () => {
    // The bug this guards: `additionalProperties: {type:'string'}` (a url-keyed map)
    // is rejected by structured outputs, so the AI call silently 400s and falls back.
    (function walk(node, path) {
      if (!node || typeof node !== "object") return;
      if (node.type === "object") {
        assert.equal(node.additionalProperties, false, `object at ${path} must set additionalProperties:false`);
      }
      if ("additionalProperties" in node) {
        assert.equal(node.additionalProperties, false, `additionalProperties at ${path} must be false, not a schema`);
      }
      for (const k of Object.keys(node.properties || {})) walk(node.properties[k], `${path}.${k}`);
      if (node.items) walk(node.items, `${path}[]`);
    })(DESIGN_SCHEMA, "$");
  });

  console.log("\nenrich — compile a rich design into a gate-passing deep funnel:");
  await check("rich design → ≥4 questions, broad coverage, trust+anti-bland+richness all pass", async () => {
    const complete = async () => richDesign();
    const r = await enrichAuthor(CATALOG, { complete });
    assert.equal(r.ok, true, r.reason);
    assert.ok(r.config.questions.length >= 4, `expected ≥4 questions, got ${r.config.questions.length}`);
    assert.equal(trustValidate(r.config).ok, true, "trust");
    assert.equal(antiBlandCheck(r.config).ok, true, "anti-bland");
    const rich = richnessCheck(r.config, CATALOG);
    assert.equal(rich.ok, true, JSON.stringify(rich.findings));
    assert.ok(rich.metrics.coverage >= 0.25, `coverage ${rich.metrics.coverage}`);
  });

  await check("every result maps to a REAL catalog product (no fabrication possible)", async () => {
    const r = await enrichAuthor(CATALOG, { complete: async () => richDesign() });
    const real = new Set(PRODUCTS.map((p) => p.url));
    for (const a of r.config.archetypes) {
      assert.ok(real.has(a.recommendations.primary.url), `archetype ${a.id} → real product`);
    }
  });

  console.log("\nenrich — grounding + repair + honest failure:");
  await check("hallucinated product URLs in the mapping are DROPPED (grounded to the real catalog)", () => {
    const design = richDesign();
    design.axes[0].productValues.push({ url: "https://evil.example/fake", value: "daily" }); // not in catalog
    const axes = designToAxes(design, CATALOG);
    const occ = axes.find((a) => a.id === "occasion");
    assert.ok(!occ.profile.has("https://evil.example/fake"), "fake url dropped");
    assert.ok(occ.profile.has(PRODUCTS[0].url), "real urls kept");
  });

  await check("a THIN first design is REPAIRED on the next attempt", async () => {
    let call = 0;
    const complete = async () => (++call === 1 ? thinDesign() : richDesign());
    const r = await enrichAuthor(CATALOG, { complete, attempts: 2 });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.meta.attempt, 2, "succeeded on the repair attempt");
    assert.ok(r.config.questions.length >= 4);
  });

  await check("a hopeless design fails HONESTLY (never ships a thin funnel as rich)", async () => {
    const r = await enrichAuthor(CATALOG, { complete: async () => thinDesign(), attempts: 2 });
    assert.equal(r.ok, false);
    assert.ok(/thin|axis|compile/.test(r.reason), r.reason);
  });

  await check("no model → honest no-op", async () => {
    const r = await enrichAuthor(CATALOG, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no-model");
  });

  console.log("\ngenerate — escalates to AI only when the catalog justifies more:");
  // Serve a JSON-LD catalog of 16 real products; deterministic author → thin → escalate.
  const graph = PRODUCTS.map((p) => ({ "@type": "Product", name: p.name, url: p.url, offers: { "@type": "Offer", price: p.price, priceCurrency: "USD", url: p.url } }));
  const HTML = `<!doctype html><html><head><meta name="theme-color" content="#e2c97e"><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</` + `script></head><body>shop</body></html>`;
  const START = ORIGIN + "/";
  const fetch = async (u) => (String(u) === START ? { ok: true, status: 200, text: async () => HTML, headers: new Map() } : { ok: false, status: 404, text: async () => "", headers: new Map() });

  await check("thin deterministic + enrich available → source 'ai', brand styling attached", async () => {
    const res = await generateFunnelFromUrl(START, { authorized: true, fetch, complete: undefined, enrich: async (cat) => enrichAuthor(cat, { complete: async () => richDesign() }) });
    assert.equal(res.ok, true, res.reason);
    assert.equal(res.source, "ai", "escalated to AI because deterministic was too thin");
    assert.ok(res.config.questions.length >= 4);
    assert.equal(res.config.themeVars["--brand"], "#e2c97e", "brand palette applied");
    assert.equal(res.trust.ok && res.bland.ok, true);
  });

  await check("no enricher on a catalog we can't mine → honest failure, never fabricated richness", async () => {
    const res = await generateFunnelFromUrl(START, { authorized: true, fetch }); // no enrich, no complete
    assert.equal(res.ok, false);
    assert.notEqual(res.source, "ai");
    assert.equal(res.stage, "author"); // honest author-stage failure, no fabrication
  });

  if (process.exitCode === 1) console.error("\nFAIL — enrich tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} enrich assertions passed.\n`);
})();
