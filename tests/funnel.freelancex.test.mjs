/**
 * tests/funnel.freelancex.test.mjs — End-to-end vertical-slice test (SPEC §16).
 *
 * Drives the WHOLE Phase-1 funnel against the real configs/freelancex.json:
 *   read config → render hero → start → render questions → save answers →
 *   advance → show progress → run scoring → render result.
 *
 * Runs in Node with a tiny DOM + localStorage shim (no browser, no deps).
 * Exits non-zero if any assertion fails.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* ----------------------------------------------------- minimal DOM shim --- */
class El {
  constructor(tag) {
    this.tagName = tag;
    this._children = [];
    this._text = "";
    this._attrs = {};
    this._listeners = {};
    this.className = "";
    this.value = "";
    this.disabled = false;
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
  get textContent() {
    if (this._text) return this._text;
    return this._children.map((c) => c.textContent).join("");
  }
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
const config = JSON.parse(readFileSync(join(__dirname, "../configs/freelancex.json"), "utf8"));

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

/** Run the funnel through a scripted set of answers, then SKIP the lead step
 *  (this suite verifies the question→result spine; the lead loop has its own
 *  suite in tests/leadloop.test.mjs). */
function runFunnel(script) {
  const root = document.createElement("main");
  const api = createFunnel(config, root);
  api.start();
  let guard = 0;
  while (api.getView() === "question" && guard++ < 50) {
    const qid = api.getState().currentStepId;
    const optId = script[qid];
    assert.ok(optId, `script missing answer for ${qid}`);
    api.select(optId);
    api.next();
  }
  if (api.getView() === "lead") api.getLeadHandle().skip(); // proceed to result
  return { root, api };
}

/* --------------------------------------------------------------- tests ---- */

console.log("\nConfig integrity (no theater — every question affects scoring):");
check("every question has at least one scoring option", () => {
  for (const q of config.questions) {
    assert.ok(
      q.options.some((o) => o.score && Object.keys(o.score).length > 0),
      `question ${q.id} contributes nothing to scoring`
    );
  }
});

console.log("\nHero + start + progress:");
check("hero renders headline", () => {
  const root = document.createElement("main");
  const api = createFunnel(config, root);
  assert.equal(api.getView(), "hero");
  assert.ok(root.textContent.includes("محتار تبدأ منين"));
});
check("start shows Q1 with progress '1 / 6'", () => {
  const root = document.createElement("main");
  const api = createFunnel(config, root);
  api.start();
  assert.equal(api.getView(), "question");
  assert.ok(root.textContent.includes("كم وقت تقدر")); // Q1 text
  assert.ok(root.textContent.includes("1 / 6")); // progress counter
  assert.ok(root.textContent.includes("الوقت")); // contextual label
});

console.log("\nFull run A — development path (with EN_GOOD flag):");
const A = runFunnel({ q1: "c", q2: "d", q3: "b", q4: "c", q5: "b", q6: "c" });
check("reaches result view", () => assert.equal(A.api.getView(), "result"));
check("all 6 answers were saved", () => assert.equal(Object.keys(A.api.getState().answers).length, 6));
check("primary = development, secondary = graphic_design", () => {
  const r = A.api.getResolved();
  assert.equal(r.primary.id, "development");
  assert.equal(r.secondary.id, "graphic_design");
});
check("scores: development 30 (incl. EN_GOOD +2), graphic_design 2", () => {
  const s = A.api.getResolved().scoring;
  assert.equal(s.scores.development, 30);
  assert.equal(s.scores.graphic_design, 2);
  assert.deepEqual(s.flags, ["EN_GOOD"]);
});
check("result screen shows the archetype + a because + score bars + CTA", () => {
  const t = A.root.textContent;
  assert.ok(t.includes("البرمجة والتطوير")); // archetype name
  assert.ok(t.includes("توصيتنا لك")); // recommendation block
  assert.ok(t.includes("حل المشكلات بالبرمجة")); // because contains chosen q2 label
  assert.ok(t.includes("توزيع نتيجتك")); // score distribution
  assert.ok(t.includes("ابدأ مسارك في FreelanceX")); // CTA
});

console.log("\nFull run B — copywriting path (URGENT + AR_ONLY flags):");
const B = runFunnel({ q1: "a", q2: "a", q3: "a", q4: "a", q5: "a", q6: "a" });
check("primary = copywriting, secondary = freelance_start", () => {
  const r = B.api.getResolved();
  assert.equal(r.primary.id, "copywriting");
  assert.equal(r.secondary.id, "freelance_start");
});
check("flags collected = [URGENT, AR_ONLY]; copywriting = 23, dev clamped to 0", () => {
  const s = B.api.getResolved().scoring;
  assert.deepEqual(s.flags, ["URGENT", "AR_ONLY"]);
  assert.equal(s.scores.copywriting, 23);
  assert.equal(s.scores.development, 0);
});
check("a different answer path yields a different result than run A", () => {
  assert.notEqual(A.api.getResolved().primary.id, B.api.getResolved().primary.id);
});

console.log("\nNavigation + restart + persistence:");
check("back returns to the previous question", () => {
  const root = document.createElement("main");
  const api = createFunnel(config, root);
  api.start();
  api.select("c"); api.next(); // now on q2
  assert.equal(api.getState().currentStepId, "q2");
  api.back();
  assert.equal(api.getState().currentStepId, "q1");
  assert.equal(api.getView(), "question");
});
check("restart clears state and returns to hero", () => {
  const { api } = runFunnel({ q1: "a", q2: "a", q3: "a", q4: "a", q5: "a", q6: "a" });
  api.restart();
  assert.equal(api.getView(), "hero");
  assert.equal(Object.keys(api.getState().answers).length, 0);
});
check("progress is persisted to localStorage", () => {
  const root = document.createElement("main");
  const api = createFunnel(config, root);
  api.start();
  api.select("b"); api.next();
  const raw = globalThis.localStorage.getItem("ftd:freelancex");
  assert.ok(raw && JSON.parse(raw).answers.q1 === "b");
});

/* -------------------------------------------------------------- summary --- */
if (process.exitCode === 1) console.error("\nFAIL — vertical-slice tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} vertical-slice assertions passed.\n`);
