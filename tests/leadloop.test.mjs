/**
 * tests/leadloop.test.mjs — Lead loop tests (SPEC §10, §12, §16).
 *
 * Verifies: funnel → lead form → submit → tagged payload reaches the transport
 * (the thing that writes the Google Sheet row), plus the sheets-sink transport
 * itself and the validation rules.
 *
 * Node + DOM/localStorage/fetch shims. No browser, no deps. Exits non-zero on
 * failure.
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
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new TextNode(t) };
const _ls = {};
globalThis.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

const tick = () => new Promise((r) => setTimeout(r, 0));

/* ------------------------------------------------------------- harness ---- */
const { createFunnel } = await import("../engine/index.js");
const { validateLead } = await import("../engine/leadCapture.js");
const { createSheetsSink } = await import("../analytics/sheets-sink.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, "../configs/freelancex.json"), "utf8"));

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

const SCRIPT = { q1: "c", q2: "d", q3: "b", q4: "c", q5: "b", q6: "c" }; // → development

/** Drive the funnel to the lead step with an injected transport. */
function runToLead(deps) {
  const root = document.createElement("main");
  const api = createFunnel(config, root, deps);
  api.start();
  let guard = 0;
  while (api.getView() === "question" && guard++ < 50) {
    api.select(SCRIPT[api.getState().currentStepId]);
    api.next();
  }
  return { root, api };
}

/* --------------------------------------------------------------- tests --- */

await (async () => {
  console.log("\nValidation:");
  const fields = config.leadForm.fields;
  await check("rejects empty + missing required name/email", () => {
    assert.equal(validateLead(fields, {}), false);
    assert.equal(validateLead(fields, { name: "سيف" }), false);
    assert.equal(validateLead(fields, { name: "سيف", email: "bad" }), false);
  });
  await check("accepts a valid name + email (phone optional)", () => {
    assert.equal(validateLead(fields, { name: "سيف", email: "a@b.com" }), true);
    assert.equal(validateLead(fields, { name: "سيف", email: "a@b.com", phone: "+96550000000" }), true);
  });

  console.log("\nLead form renders after the last question:");
  await check("view becomes 'lead' and form shows fields + skip", () => {
    const { root, api } = runToLead({ submitLead: async () => ({ ok: true }) });
    assert.equal(api.getView(), "lead");
    const t = root.textContent;
    assert.ok(t.includes("البريد الإلكتروني")); // email label
    assert.ok(t.includes("اعرض نتيجتي")); // submit label
    assert.ok(t.includes("تخطّي")); // skip
  });
  await check("submit is disabled until valid, enabled after fill", () => {
    const { api } = runToLead({ submitLead: async () => ({ ok: true }) });
    assert.equal(api.getLeadHandle().isSubmitDisabled(), true);
    api.getLeadHandle().fill({ name: "سيف", email: "saif@example.com" });
    assert.equal(api.getLeadHandle().isSubmitDisabled(), false);
  });

  console.log("\nSubmit → tagged payload reaches the transport:");
  await check("payload carries email, archetype, flags, answers, dedupeKey; then shows result", async () => {
    const captured = [];
    const fake = async (payload) => { captured.push(payload); return { ok: true }; };
    const { api } = runToLead({ submitLead: fake });
    api.getLeadHandle().fill({ name: "سيف", email: "Saif@Example.com", phone: "+96550000000" });
    api.getLeadHandle().submit();
    await tick();

    assert.equal(captured.length, 1, "transport called exactly once");
    const p = captured[0];
    assert.equal(p.funnelId, "freelancex");
    assert.equal(p.email, "Saif@Example.com");
    assert.equal(p.dedupeKey, "saif@example.com"); // lowercased
    assert.equal(p.primaryArchetype, "development"); // tagged with result
    assert.ok(Array.isArray(p.flags) && p.flags.includes("EN_GOOD"));
    assert.equal(Object.keys(p.answers).length, 6);
    assert.equal(p.resultLayout, "tracks");
    assert.equal(api.getView(), "result"); // advanced after success
  });

  console.log("\nSkip path:");
  await check("skipping reaches result without calling the transport", () => {
    const captured = [];
    const fake = async (p) => { captured.push(p); return { ok: true }; };
    const { api } = runToLead({ submitLead: fake });
    api.getLeadHandle().skip();
    assert.equal(api.getView(), "result");
    assert.equal(captured.length, 0);
  });

  console.log("\nFailure path (no silent success):");
  await check("failed submit keeps user on the lead form (does not advance)", async () => {
    const fake = async () => ({ ok: false, reason: "network" });
    const { api } = runToLead({ submitLead: fake });
    api.getLeadHandle().fill({ name: "سيف", email: "saif@example.com" });
    api.getLeadHandle().submit();
    await tick();
    assert.equal(api.getView(), "lead"); // stayed put — no false success
  });

  console.log("\nsheets-sink transport:");
  await check("posts JSON body to the endpoint and reports ok (sent)", async () => {
    let lastCall = null;
    globalThis.fetch = async (url, opts) => { lastCall = { url, opts }; return { ok: true }; };
    const sink = createSheetsSink("https://script.google.com/macros/s/AAA/exec");
    const res = await sink.submit({ funnelId: "freelancex", email: "a@b.com" });
    assert.equal(res.ok, true);
    assert.ok(lastCall.url.endsWith("/exec"));
    assert.equal(lastCall.opts.method, "POST");
    assert.ok(lastCall.opts.body.includes("a@b.com"));
  });
  await check("placeholder/empty endpoint → ok:false and NO network call", async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true }; };
    const r1 = await createSheetsSink("PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE").submit({ email: "x@y.com" });
    const r2 = await createSheetsSink("").submit({ email: "x@y.com" });
    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
    assert.equal(called, false);
  });
  await check("network failure → ok:false with reason 'network'", async () => {
    globalThis.fetch = async () => { throw new Error("offline"); };
    const res = await createSheetsSink("https://x/exec").submit({ funnelId: "freelancex", email: "y@z.com" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "network");
  });
  await check("submitted lead is kept in a localStorage audit queue", async () => {
    globalThis.fetch = async () => ({ ok: true });
    await createSheetsSink("https://x/exec").submit({ funnelId: "audittest", email: "q@w.com" });
    const raw = globalThis.localStorage.getItem("ftd:leads:audittest");
    assert.ok(raw && JSON.parse(raw)[0].email === "q@w.com");
  });

  if (process.exitCode === 1) console.error("\nFAIL — lead-loop tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} lead-loop assertions passed.\n`);
})();
