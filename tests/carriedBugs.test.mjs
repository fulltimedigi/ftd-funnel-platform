/**
 * tests/carriedBugs.test.mjs — Guards for the four "carried bugs" (ADR-0011).
 *
 * ADR-0003 listed four bugs from the production engine. Three never entered this
 * v0-seeded tree; this suite PROVES they are absent and locks them so they can't
 * regress:
 *   1. mount-selector restart — restart() re-renders into the original mount
 *      element (no #funnel/#ftd-app re-query), and the funnel is reusable after.
 *   2. `track-based` scoring mode — the executable schema (ADR-0009) rejects it
 *      (and any invalid mode), so a scaffolder can never smuggle it in.
 *   3. missing theme file — every config's declared theme has a real
 *      themes/<name>.css on disk.
 * (The fourth, the GA4 CSP, is a deploy-config concern — see docs/DEPLOY.md.)
 *
 * Node + a minimal DOM/localStorage shim. No browser, no deps.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* ----------------------------------------------------- minimal DOM shim --- */
class El {
  constructor(tag) {
    this.tagName = tag; this._children = []; this._text = ""; this._attrs = {};
    this._listeners = {}; this.className = ""; this.value = ""; this.disabled = false; this.style = {};
  }
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
const _ls = {};
globalThis.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

/* ------------------------------------------------------------- harness ---- */
const { createFunnel } = await import("../engine/index.js");
const { validateConfig } = await import("../engine/validateConfig.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const configsDir = join(__dirname, "../configs");
const themesDir = join(__dirname, "../themes");
const load = (n) => JSON.parse(readFileSync(join(configsDir, n), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const schema = load("_schema.json");
const freelancex = load("freelancex.json");

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

const SCRIPT = { q1: "c", q2: "d", q3: "b", q4: "c", q5: "b", q6: "c" };

/* --------------------------------------------------------------- tests --- */
await (async () => {
  console.log("\nBug 1 — restart re-renders into the original mount element (no selector re-query):");
  await check("restart from the result returns to hero in the SAME mount, and the funnel is reusable", () => {
    const root = document.createElement("main");
    const api = createFunnel(freelancex, root, { submitLead: async () => ({ ok: true }) });
    api.start();
    let guard = 0;
    while (api.getView() === "question" && guard++ < 50) {
      api.select(SCRIPT[api.getState().currentStepId]);
      api.next();
    }
    api.getLeadHandle().skip();
    assert.equal(api.getView(), "result");

    api.restart();
    assert.equal(api.getView(), "hero");
    assert.equal(api.getState().history.length, 0, "history cleared");
    assert.equal(Object.keys(api.getState().answers).length, 0, "answers cleared");
    // Hero content landed in the ORIGINAL root element (not a re-queried selector).
    assert.ok(root.textContent.includes(freelancex.hero.startLabel || "ابدأ"), "hero re-rendered into root");

    // Reusable: starting again drives questions in the same element.
    api.start();
    assert.equal(api.getView(), "question");
    assert.ok(root.textContent.includes("١ / ٦"), "Q1 renders again after restart");
  });

  console.log("\nBug 2 — the executable schema rejects the invalid `track-based` scoring mode:");
  await check("scoring.mode 'track-based' is invalid (and a valid mode passes)", () => {
    const bad = clone(freelancex); bad.scoring.mode = "track-based";
    const res = validateConfig(bad, schema);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.path.includes("scoring.mode")));
    // sanity: the shipped mode is accepted
    assert.equal(validateConfig(freelancex, schema).valid, true);
  });

  console.log("\nBug 3 — every config's declared theme has a real CSS file:");
  const configFiles = readdirSync(configsDir).filter((f) => f.endsWith(".json") && f !== "_schema.json");
  for (const f of configFiles) {
    await check(`${f} theme file exists`, () => {
      const theme = load(f).theme;
      assert.ok(theme, `${f} declares a theme`);
      assert.ok(existsSync(join(themesDir, `${theme}.css`)), `themes/${theme}.css must exist`);
    });
  }

  if (process.exitCode === 1) console.error("\nFAIL — carried-bug guards did not all pass.\n");
  else console.log(`\nPASS — all ${passed} carried-bug guard assertions passed.\n`);
})();
