/**
 * tests/asq.test.mjs — Proof that this is an ENGINE, not a FreelanceX clone.
 *
 * Runs ASQ Perfume (dominant scoring, commerce layout, luxury theme) on the
 * SAME engine that runs FreelanceX (weighted-multi, tracks, platform theme),
 * with the only difference being the config + theme. No ASQ logic in JS.
 *
 * Node + DOM/localStorage shims (incl. document.head so theme injection is
 * observable). Exits non-zero on failure.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* ----------------------------------------------------- minimal DOM shim --- */
class El {
  constructor(tag) {
    this.tagName = tag; this._children = []; this._text = ""; this._attrs = {};
    this._listeners = {}; this.className = ""; this.value = ""; this.disabled = false;
  }
  appendChild(c) { this._children.push(c); return c; }
  removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; }
  get firstChild() { return this._children[0] || null; }
  get lastChild() { return this._children[this._children.length - 1] || null; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  click() { (this._listeners.click || []).forEach((fn) => fn({})); }
  set textContent(v) { this._text = String(v); this._children = []; }
  get textContent() { return this._text ? this._text : this._children.map((c) => c.textContent).join(""); }
}
class TextNode { constructor(t) { this._text = String(t); } get textContent() { return this._text; } }
globalThis.document = {
  head: new El("head"),
  createElement: (t) => new El(t),
  createTextNode: (t) => new TextNode(t),
};
const _ls = {};
globalThis.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

/* ------------------------------------------------------------- harness ---- */
const { createFunnel } = await import("../engine/index.js"); // ONE engine import
const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(__dirname, "../configs/" + f), "utf8"));
const ASQ = load("asq-perfume.json");
const FX = load("freelancex.json");

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

/** Drive a funnel to its result (skipping the lead step). Returns {root, api}. */
function drive(config, script) {
  const root = document.createElement("main");
  const api = createFunnel(config, root, { submitLead: async () => ({ ok: true }) });
  api.start();
  let g = 0;
  while (api.getView() === "question" && g++ < 50) {
    api.select(script[api.getState().currentStepId]);
    api.next();
  }
  if (api.getView() === "lead") api.getLeadHandle().skip();
  return { root, api };
}

function themeLink(name) {
  return document.head._children.find((l) => l.getAttribute && l.getAttribute("data-ftd-theme") === name);
}

const ASQ_SCRIPT = { identity: "intimate", scent: "oud", presence: "bold", occasion: "majlis", season: "winter" };
const FX_SCRIPT = { q1: "c", q2: "d", q3: "b", q4: "c", q5: "b", q6: "c" };

/* --------------------------------------------------------------- tests --- */

console.log("\nASQ config integrity (no theater — every question scores):");
check("every ASQ question contributes to scoring", () => {
  for (const q of ASQ.questions) {
    assert.ok(q.options.some((o) => o.score && Object.keys(o.score).length > 0), `${q.id} scores nothing`);
  }
});

console.log("\nASQ loads its theme from config (not hardcoded):");
check("engine selects luxury-gold-light and injects the stylesheet", () => {
  const root = document.createElement("main");
  const api = createFunnel(ASQ, root, { submitLead: async () => ({ ok: true }) });
  assert.equal(api.getTheme(), "luxury-gold-light");
  const link = themeLink("luxury-gold-light");
  assert.ok(link, "theme <link> injected");
  assert.ok(link.getAttribute("href").includes("luxury-gold-light.css"));
});

console.log("\nASQ runs dominant scoring (every question matters):");
check("primary = rooted, decided by Q2–Q5 not just Q1", () => {
  const { api } = drive(ASQ, ASQ_SCRIPT);
  const r = api.getResolved();
  assert.equal(r.primary.id, "rooted"); // Q1 was 'intimate' — did not dominate
  assert.equal(r.secondary.id, "intimate");
  assert.equal(r.scoring.scores.rooted, 8);
});

console.log("\nASQ renders the COMMERCE layout (config-driven dispatch):");
check("result section is commerce, not tracks", () => {
  const { root } = drive(ASQ, ASQ_SCRIPT);
  assert.ok(root.firstChild.className.includes("ftd-result-commerce"));
});
check("shows signature recommendation, price, because, contextual grid, shop CTA", () => {
  const { root } = drive(ASQ, ASQ_SCRIPT);
  const t = root.textContent;
  assert.ok(t.includes("توقيعك العطري")); // recommendationTitle (config copy)
  assert.ok(t.includes("المزيج الملكي")); // signature product name
  assert.ok(t.includes("٣٤ د.ك")); // price
  assert.ok(t.includes("خصم ٥٠٪")); // discount badge
  assert.ok(t.includes("العود")); // because resolved from chosen q2 label
  assert.ok(t.includes("لكل مناسبة")); // contextual grid title
  assert.ok(t.includes("الأنسب لك")); // best-for-you badge on first card
  assert.ok(t.includes("تسوّق")); // shop CTA
});
check("commerce layout has NO score-distribution bars", () => {
  const { root } = drive(ASQ, ASQ_SCRIPT);
  assert.ok(!root.textContent.includes("توزيع"));
});

console.log("\nDual-engine proof — same code, different funnels:");
check("FreelanceX = tracks + platform-clean; ASQ = commerce + luxury-gold-light", () => {
  const fx = drive(FX, FX_SCRIPT);
  const asq = drive(ASQ, ASQ_SCRIPT);

  // Same engine entrypoint
  assert.equal(typeof createFunnel, "function");

  // Different themes (visual difference is theme-only)
  assert.equal(fx.api.getTheme(), "platform-clean");
  assert.equal(asq.api.getTheme(), "luxury-gold-light");
  assert.notEqual(fx.api.getTheme(), asq.api.getTheme());

  // Different layouts, chosen by config.resultLayout
  assert.ok(fx.root.firstChild.className.includes("ftd-result-tracks"));
  assert.ok(asq.root.firstChild.className.includes("ftd-result-commerce"));

  // Different content surfaces
  assert.ok(fx.root.textContent.includes("توزيع نتيجتك")); // tracks-only score bars
  assert.ok(asq.root.textContent.includes("لكل مناسبة")); // commerce-only grid
  assert.ok(!asq.root.textContent.includes("توزيع")); // ASQ has no bars
});
check("FreelanceX still works end-to-end on the shared engine", () => {
  const { api } = drive(FX, FX_SCRIPT);
  assert.equal(api.getResolved().primary.id, "development");
  assert.equal(api.getView(), "result");
});

if (process.exitCode === 1) console.error("\nFAIL — engine-model proof did not pass.\n");
else console.log(`\nPASS — all ${passed} engine-model assertions passed.\n`);
