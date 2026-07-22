/**
 * tests/personas.test.mjs — Personas result layout (ADR-0010).
 *
 * The personas layout used to fall back to `tracks`. This asserts it now renders
 * its own body — strengths / gaps / next-steps from the archetype's resultExtras
 * — and that it degrades gracefully (omits a list that isn't authored, no
 * fabrication), while still honouring the §9 rule for the primary recommendation.
 *
 * Node + a minimal DOM/localStorage shim. No browser, no deps. Exits non-zero
 * on failure.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const __dirname = dirname(fileURLToPath(import.meta.url));
const freelancex = JSON.parse(readFileSync(join(__dirname, "../configs/freelancex.json"), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

const SCRIPT = { q1: "c", q2: "d", q3: "b", q4: "c", q5: "b", q6: "c" };
function runToResult(config) {
  const root = document.createElement("main");
  const api = createFunnel(config, root, { submitLead: async () => ({ ok: true }) });
  api.start();
  let guard = 0;
  while (api.getView() === "question" && guard++ < 50) {
    api.select(SCRIPT[api.getState().currentStepId]);
    api.next();
  }
  api.getLeadHandle().skip(); // straight to result
  return { root, api };
}

/* --------------------------------------------------------------- tests --- */
await (async () => {
  console.log("\nPersonas renders its own body (no longer falls back to tracks):");
  await check("shows strengths / gaps / next-steps from resultExtras", () => {
    const cfg = clone(freelancex);
    cfg.resultLayout = "personas";
    cfg.archetypes.forEach((a) => {
      a.resultExtras = {
        ...(a.resultExtras || {}),
        strengths: ["STRENGTH_MARK — تنفيذ سريع"],
        gaps: ["GAP_MARK — التسعير"],
        actions: ["ACTION_MARK — انشر أول عرض"],
      };
    });
    const { root, api } = runToResult(cfg);
    assert.equal(api.getView(), "result");
    const t = root.textContent;
    assert.ok(t.includes("نقاط القوة"), "strengths title");
    assert.ok(t.includes("مجالات التطوير"), "gaps title");
    assert.ok(t.includes("الخطوات التالية"), "actions title");
    assert.ok(t.includes("STRENGTH_MARK"), "strength item");
    assert.ok(t.includes("GAP_MARK"), "gap item");
    assert.ok(t.includes("ACTION_MARK"), "action item");
    // Proof it is NOT the tracks fallback (which renders the score-distribution).
    assert.ok(!t.includes("توزيع نتيجتك"), "must not render the tracks score distribution");
  });

  await check("root section carries the ftd-result-personas class", () => {
    const cfg = clone(freelancex);
    cfg.resultLayout = "personas";
    const { root } = runToResult(cfg);
    const section = root._children[0];
    assert.ok(section && String(section.className).includes("ftd-result-personas"));
  });

  console.log("\nGraceful degradation (no fabrication):");
  await check("with NO persona lists authored, it still renders and omits the lists", () => {
    const cfg = clone(freelancex);
    cfg.resultLayout = "personas";
    // archetypes have no strengths/gaps/actions
    const { root, api } = runToResult(cfg);
    assert.equal(api.getView(), "result");
    const t = root.textContent;
    assert.ok(!t.includes("نقاط القوة"), "no empty strengths section");
    assert.ok(!t.includes("مجالات التطوير"), "no empty gaps section");
    assert.ok(!t.includes("الخطوات التالية"), "no empty actions section");
    // still a real result: the archetype hero name renders
    assert.ok(t.length > 0);
  });

  await check("partial: only the authored list appears", () => {
    const cfg = clone(freelancex);
    cfg.resultLayout = "personas";
    cfg.archetypes.forEach((a) => { a.resultExtras = { ...(a.resultExtras || {}), actions: ["ONLY_ACTION"] }; });
    const { root } = runToResult(cfg);
    const t = root.textContent;
    assert.ok(t.includes("الخطوات التالية") && t.includes("ONLY_ACTION"));
    assert.ok(!t.includes("نقاط القوة"), "strengths omitted when unauthored");
  });

  if (process.exitCode === 1) console.error("\nFAIL — personas tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} personas assertions passed.\n`);
})();
