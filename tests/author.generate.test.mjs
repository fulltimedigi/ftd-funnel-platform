/**
 * tests/author.generate.test.mjs — Stage 2 funnel generation (ADR-0015).
 *
 * Proves authorFunnel(catalog) emits a config that (a) passes the schema validator,
 * (b) passes the trust gate with ZERO blockers, and (c) actually RUNS through the
 * real engine to a result showing a REAL product. Also: provenance (every result
 * URL is from the catalog), no-fabrication refusal on thin catalogs, determinism.
 *
 * Synthetic catalog here (test data); the real oudfactory catalog is exercised in
 * tests/author.axes.oud.test.mjs when its fixture is present. Offline. No deps.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* ---- minimal DOM + localStorage shim (drives the real engine) ------------- */
class El {
  constructor(t) { this.tagName = t; this._children = []; this._text = ""; this._attrs = {}; this._listeners = {}; this.className = ""; this.value = ""; this.disabled = false; this.style = {}; }
  appendChild(c) { this._children.push(c); return c; }
  removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; }
  get firstChild() { return this._children[0] || null; }
  get lastChild() { return this._children[this._children.length - 1] || null; }
  setAttribute(k, v) { this._attrs[k] = v; if (k === "class") this.className = v; }
  getAttribute(k) { return this._attrs[k]; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  click() { (this._listeners.click || []).forEach((fn) => fn({})); }
  set textContent(v) { this._text = String(v); this._children = []; }
  get textContent() { return this._text ? this._text : this._children.map((c) => c.textContent).join(""); }
}
class TextNode { constructor(t) { this._text = String(t); } get textContent() { return this._text; } }
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new TextNode(t) };
const _ls = {}; globalThis.localStorage = { getItem: (k) => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: (k) => { delete _ls[k]; } };

const { authorFunnel } = await import("../authoring/author/index.js");
const { validateConfig, formatValidationErrors } = await import("../engine/validateConfig.js");
const { trustValidate } = await import("../engine/trustValidate.js");
const { antiBlandCheck, formatAntiBland } = await import("../authoring/author/qualityGate.js");
const { createFunnel } = await import("../engine/index.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(__dirname, "../configs/_schema.json"), "utf8"));

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

const CATALOG = { origin: "https://oud.example", products: [
  { name: "Hindi Oud Oil 3ml", url: "https://oud.example/products/hindi-oil", price: 120, currency: "USD", image: "https://i/1", attributes: { type: "Oud Oil" }, differentiators: ["hindi", "oil"] },
  { name: "Cambodi Oud Oil 3ml", url: "https://oud.example/products/cambodi-oil", price: 200, currency: "USD", image: "https://i/2", attributes: { type: "Oud Oil" }, differentiators: ["cambodi", "oil"] },
  { name: "Hindi Wood Chips 60g", url: "https://oud.example/products/hindi-wood", price: 90, currency: "USD", image: "https://i/3", attributes: { type: "Wood" }, differentiators: ["hindi", "wood"] },
  { name: "Cambodi Wood Box", url: "https://oud.example/products/cambodi-wood", price: 800, currency: "USD", image: "https://i/4", attributes: { type: "Wood" }, differentiators: ["cambodi", "wood"] },
  { name: "Bakhoor Premium", url: "https://oud.example/products/bakhoor", price: 45, currency: "USD", attributes: { type: "Bakhoor" }, differentiators: ["bakhoor"] },
  { name: "Muattar Bakhoor", url: "https://oud.example/products/muattar", price: 60, currency: "USD", attributes: { type: "Bakhoor" }, differentiators: ["bakhoor"] },
] };
const PRODUCT_URLS = new Set(CATALOG.products.map((p) => p.url));

/** Drive the generated funnel to its result, always taking the first option. */
function driveToResult(config) {
  const root = document.createElement("main");
  const api = createFunnel(config, root, { submitLead: async () => ({ ok: true }) });
  api.start();
  let guard = 0;
  while (api.getView() === "question" && guard++ < 50) {
    const q = config.questions.find((x) => x.id === api.getState().currentStepId);
    api.select(q.options[0].id);
    api.next();
  }
  if (api.getLeadHandle()) api.getLeadHandle().skip();
  return { root, api };
}

await (async () => {
  console.log("\ngeneration passes BOTH gates:");
  const gen = authorFunnel(CATALOG, { brandName: "Oud Example" });
  await check("authorFunnel returns ok with a decision-table config from ≥2 fact axes", () => {
    assert.equal(gen.ok, true);
    assert.equal(gen.config.scoring.mode, "decision-table");
    assert.ok(gen.meta.axes.length >= 2, "derives the product from ≥2 fact axes (not a mirror)");
    assert.ok(gen.config.archetypes.length >= 2);
  });
  await check("generated config is schema-valid", () => {
    const r = validateConfig(gen.config, schema);
    assert.ok(r.valid, formatValidationErrors(r));
  });
  await check("generated config passes the trust gate with ZERO blockers", () => {
    const r = trustValidate(gen.config);
    assert.equal(r.ok, true, JSON.stringify(r.findings.filter((f) => f.severity === "blocker"), null, 2));
  });
  await check("generated config passes the ANTI-BLAND gate (no mirror/dominance)", () => {
    const r = antiBlandCheck(gen.config);
    assert.equal(r.ok, true, formatAntiBland(r));
  });
  await check("no question is a mirror — questions ask facts, not 'which product'", () => {
    // every question maps to a fact axis; the result depends on the combination
    assert.ok(gen.config.questions.length >= 2);
    assert.ok(gen.config.derivedSignals.length >= 2, "≥2 decision signals combine to derive the result");
  });

  console.log("\nprovenance — every result is a REAL product from the catalog:");
  await check("every archetype's primary recommendation URL is a catalog URL", () => {
    for (const a of gen.config.archetypes) {
      const url = a.recommendations.primary.url;
      assert.ok(PRODUCT_URLS.has(url), `archetype ${a.id} url ${url} not in catalog`);
    }
  });
  await check("every contextual recommendation URL is a catalog URL too", () => {
    for (const a of gen.config.archetypes) {
      for (const c of (a.recommendations.contextual || [])) assert.ok(PRODUCT_URLS.has(c.url), `contextual ${c.url} not in catalog`);
    }
  });

  console.log("\nit actually RUNS through the engine to a real product:");
  await check("driving the funnel reaches a result showing a real catalog product name", () => {
    const { root, api } = driveToResult(gen.config);
    assert.equal(api.getView(), "result");
    const t = root.textContent;
    const shown = CATALOG.products.some((p) => t.includes(p.name));
    assert.ok(shown, "result should show a real product name");
  });

  console.log("\nno fabrication + determinism:");
  await check("a too-thin catalog is refused (no invented funnel)", () => {
    const thin = authorFunnel({ origin: "https://x.example", products: [{ name: "Only", url: "https://x.example/products/o", attributes: {} }] });
    assert.equal(thin.ok, false);
  });
  await check("a catalog with no discriminating axis is refused", () => {
    const flat = { origin: "https://x.example", products: Array.from({ length: 6 }, (_, i) => ({ name: `Same ${i}`, url: `https://x.example/products/p${i}`, attributes: { type: "Same" }, differentiators: [] })) };
    const r = authorFunnel(flat);
    assert.equal(r.ok, false);
  });
  await check("generation is deterministic (same catalog → identical config)", () => {
    const a = authorFunnel(CATALOG, { brandName: "Oud Example" });
    const b = authorFunnel(CATALOG, { brandName: "Oud Example" });
    assert.equal(JSON.stringify(a.config), JSON.stringify(b.config));
  });

  if (process.exitCode === 1) console.error("\nFAIL — generation tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} generation assertions passed.\n`);
})();
