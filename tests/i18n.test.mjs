/**
 * tests/i18n.test.mjs — Arabic RTL + numerals (ADR-0008).
 *
 * Verifies the pure i18n helpers (numeral conversion, isRTL, step/percent/blend
 * formatting, template fill, sanitize), host-safety of the two DOM helpers, and
 * the WIRING: a lang=ar funnel renders Arabic-Indic numerals in the progress
 * counter and in the result score bars.
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
  setAttribute(k, v) { this._attrs[k] = v; }
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
const i18n = await import("../engine/i18n-rtl.js");
const { createFunnel } = await import("../engine/index.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, "../configs/freelancex.json"), "utf8"));

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

const AR = /[٠-٩]/; // any Arabic-Indic digit
const SCRIPT = { q1: "c", q2: "d", q3: "b", q4: "c", q5: "b", q6: "c" };

/* --------------------------------------------------------------- tests --- */
await (async () => {
  console.log("\nNumeral conversion:");
  await check("toArabicNumerals maps every Western digit", () => {
    assert.equal(i18n.toArabicNumerals("1 / 6"), "١ / ٦");
    assert.equal(i18n.toArabicNumerals(2026), "٢٠٢٦");
    assert.equal(i18n.toArabicNumerals("no digits"), "no digits");
  });

  await check("localizeNum switches on language", () => {
    assert.equal(i18n.localizeNum(64, "ar"), "٦٤");
    assert.equal(i18n.localizeNum(64, "en"), "64");
    assert.equal(i18n.localizeNum(64, "ar-KW"), "٦٤");
  });

  console.log("\nisRTL:");
  await check("Arabic/Farsi/Hebrew/Urdu are RTL; others (and empty) are not", () => {
    assert.equal(i18n.isRTL("ar"), true);
    assert.equal(i18n.isRTL("ar-KW"), true);
    assert.equal(i18n.isRTL("fa"), true);
    assert.equal(i18n.isRTL("he"), true);
    assert.equal(i18n.isRTL("en"), false);
    assert.equal(i18n.isRTL(undefined), false);
  });

  console.log("\nFormatters:");
  await check("step / percent / blend are locale-aware", () => {
    assert.equal(i18n.formatStepCounter(1, 6, "ar"), "١ / ٦");
    assert.equal(i18n.formatStepCounter(1, 6, "en"), "1 / 6");
    assert.equal(i18n.formatPercent(63.6, "ar"), "٦٤٪");
    assert.equal(i18n.formatPercent(63.6, "en"), "64%");
    assert.equal(i18n.formatBlend(64, 36, "متخصص", "بانٍ", "ar"), "٦٤٪ متخصص · ٣٦٪ بانٍ");
    assert.equal(i18n.formatBlend(64, 36, "A", "B", "en"), "64% A · 36% B");
  });

  console.log("\nTemplate + sanitize:");
  await check("fillTemplate replaces {qid} with the chosen option label", () => {
    const questions = [{ id: "q1", options: [{ id: "a", label: "بسرعة" }, { id: "b", label: "بروية" }] }];
    assert.equal(i18n.fillTemplate("اخترت {q1}", { q1: "a" }, questions), "اخترت بسرعة");
    assert.equal(i18n.fillTemplate("اخترت {q1}", {}, questions), "اخترت {q1}"); // unresolved kept
    assert.equal(i18n.fillTemplate("", {}, questions), "");
  });

  await check("sanitizeText strips HTML", () => {
    assert.equal(i18n.sanitizeText("<b>مرحبا</b>"), "مرحبا");
    assert.equal(i18n.sanitizeText(42), "42");
  });

  console.log("\nHost-safety (no throw without a real DOM):");
  await check("applyDocumentLocale is a no-op and never throws under the shim", () => {
    i18n.applyDocumentLocale("ar"); // document has no documentElement — guarded
    const mount = document.createElement("main");
    i18n.applyDocumentLocale("ar", mount); // sets attrs on the mount
    assert.equal(mount.getAttribute("dir"), "rtl");
    assert.equal(mount.getAttribute("lang"), "ar");
  });

  await check("applyLTRInputs forces dir=ltr on matched inputs; no-op on unqueryable root", () => {
    const email = document.createElement("input");
    const fakeRoot = { querySelectorAll: () => [email] };
    i18n.applyLTRInputs(fakeRoot);
    assert.equal(email.getAttribute("dir"), "ltr");
    assert.equal(email.style.textAlign, "left");
    i18n.applyLTRInputs({}); // no querySelectorAll — must not throw
    assert.ok(true);
  });

  console.log("\nWiring: a lang=ar funnel renders Arabic-Indic numerals:");
  await check("progress counter shows ١ / ٦ (not 1 / 6)", () => {
    const root = document.createElement("main");
    const api = createFunnel(config, root, { submitLead: async () => ({ ok: true }) });
    api.start();
    const t = root.textContent;
    assert.ok(t.includes("١ / ٦"), "expected Arabic progress counter");
    assert.ok(!t.includes("1 / 6"), "no Western progress counter");
  });

  await check("result score bars render Arabic-Indic digits", () => {
    const root = document.createElement("main");
    const api = createFunnel(config, root, { submitLead: async () => ({ ok: true }) });
    api.start();
    let guard = 0;
    while (api.getView() === "question" && guard++ < 50) {
      api.select(SCRIPT[api.getState().currentStepId]);
      api.next();
    }
    api.getLeadHandle().skip(); // straight to result
    assert.equal(api.getView(), "result");
    assert.ok(AR.test(root.textContent), "expected an Arabic-Indic digit in the result");
  });

  if (process.exitCode === 1) console.error("\nFAIL — i18n tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} i18n assertions passed.\n`);
})();
