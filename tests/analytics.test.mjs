/**
 * tests/analytics.test.mjs — Analytics bus + sinks (ADR-0007).
 *
 * Verifies: the event bus (init/register/emit + typed emitters), that a throwing
 * sink never breaks emit, host-safety of both sinks (GA4 with/without gtag; the
 * Sheets event sink with/without endpoint), and the END-TO-END event sequence a
 * driven funnel produces (quiz_start → question_answered → lead_* → result_shown
 * → funnel_complete), including leadCaptured true/false on submit vs skip.
 *
 * Node + a minimal DOM/localStorage shim (same shape as leadloop). No browser,
 * no deps. Exits non-zero on failure.
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
const analytics = await import("../engine/analytics.js");
const { registerSink: registerGa4 } = await import("../analytics/ga4-sink.js");
const { registerSink: registerSheetsEvent } = await import("../analytics/sheets-sink.js");
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

const SCRIPT = { q1: "c", q2: "d", q3: "b", q4: "c", q5: "b", q6: "c" }; // → reaches lead

/* --------------------------------------------------------------- tests --- */
await (async () => {
  console.log("\nEvent bus:");
  await check("emit delivers a shaped event (event, funnelId, timestamp, payload) to sinks", () => {
    analytics.resetAnalytics();
    analytics.initAnalytics("f_bus");
    const got = [];
    analytics.registerSink((e) => got.push(e));
    analytics.emit("quiz_start", { theme: "lux" });
    assert.equal(got.length, 1);
    assert.equal(got[0].event, "quiz_start");
    assert.equal(got[0].funnelId, "f_bus");
    assert.equal(got[0].theme, "lux");
    assert.ok(got[0].timestamp.includes("T"));
  });

  await check("a throwing sink never breaks emit; other sinks still receive the event", () => {
    analytics.resetAnalytics();
    const got = [];
    analytics.registerSink(() => { throw new Error("bad sink"); });
    analytics.registerSink((e) => got.push(e.event));
    analytics.emit("restart", {}); // must not throw
    assert.deepEqual(got, ["restart"]);
  });

  await check("resetAnalytics drops all sinks", () => {
    analytics.resetAnalytics();
    let hits = 0;
    analytics.registerSink(() => { hits++; });
    analytics.resetAnalytics();
    analytics.emit("restart", {});
    assert.equal(hits, 0);
  });

  await check("typed emitters carry their documented payloads", () => {
    analytics.resetAnalytics();
    analytics.initAnalytics("f_typed");
    const got = [];
    analytics.registerSink((e) => got.push(e));
    analytics.emitQuestionAnswered("q2", "b", 2);
    analytics.emitLeadSubmitted(true);
    analytics.emitFunnelComplete("dev", false);
    assert.deepEqual(got[0], { event: "question_answered", funnelId: "f_typed", timestamp: got[0].timestamp, questionId: "q2", optionId: "b", stepIndex: 2 });
    assert.equal(got[1].success, true);
    assert.equal(got[2].event, "funnel_complete");
    assert.equal(got[2].leadCaptured, false);
  });

  console.log("\nGA4 sink (host-safe):");
  await check("with window.gtag present → maps name + params and calls gtag", () => {
    const calls = [];
    globalThis.window = { gtag: (...a) => calls.push(a) };
    analytics.resetAnalytics();
    analytics.initAnalytics("f_ga4");
    registerGa4("G-ABC123");
    analytics.emit("question_answered", { questionId: "q1", optionId: "c", stepIndex: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "event");
    assert.equal(calls[0][1], "question_answered");
    assert.equal(calls[0][2].funnel_id, "f_ga4");
    assert.equal(calls[0][2].send_to, "G-ABC123");
    assert.equal(calls[0][2].question_id, "q1");
    assert.equal(calls[0][2].step_index, 1);
  });

  await check("with no gtag (Node) → skips silently, never throws", () => {
    delete globalThis.window; // back to a no-window host
    analytics.resetAnalytics();
    registerGa4("G-ABC123");
    analytics.emit("quiz_start", { theme: "x" }); // must not throw
    assert.ok(true);
  });

  await check("empty measurementId registers no sink (disabled)", () => {
    analytics.resetAnalytics();
    let hits = 0;
    analytics.registerSink(() => hits++); // sentinel
    registerGa4(""); // should NOT add a sink
    analytics.emit("restart", {});
    assert.equal(hits, 1); // only the sentinel fired
  });

  console.log("\nSheets event sink (host-safe, honest):");
  await check("posts a {type:'event'} body to the endpoint", async () => {
    let last = null;
    globalThis.fetch = async (url, opts) => { last = { url, opts }; return { ok: true }; };
    analytics.resetAnalytics();
    analytics.initAnalytics("f_sheet");
    registerSheetsEvent("https://script.google.com/macros/s/AAA/exec");
    analytics.emit("result_shown", { primaryArchetype: "dev" });
    await tick();
    assert.ok(last.url.endsWith("/exec"));
    assert.equal(last.opts.method, "POST");
    assert.ok(last.opts.body.includes('"type":"event"'));
    assert.ok(last.opts.body.includes('"event":"result_shown"'));
    assert.ok(last.opts.body.includes("dev"));
  });

  await check("placeholder/empty endpoint → no sink registered, no network call", async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true }; };
    analytics.resetAnalytics();
    registerSheetsEvent("PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE");
    registerSheetsEvent("");
    analytics.emit("restart", {});
    await tick();
    assert.equal(called, false);
  });

  console.log("\nEnd-to-end: a driven funnel emits the lifecycle sequence:");
  await check("submit path → quiz_start · question_answered · lead_shown · lead_submitted(ok) · result_shown · funnel_complete(captured)", async () => {
    analytics.resetAnalytics();
    globalThis.fetch = async () => ({ ok: true }); // absorb any config sinks
    const root = document.createElement("main");
    const events = [];
    const api = createFunnel(config, root, { submitLead: async () => ({ ok: true }) });
    analytics.registerSink((e) => events.push(e));
    api.start();
    let guard = 0;
    while (api.getView() === "question" && guard++ < 50) {
      api.select(SCRIPT[api.getState().currentStepId]);
      api.next();
    }
    api.getLeadHandle().fill({ name: "سيف", email: "saif@example.com" });
    api.getLeadHandle().submit();
    await tick();

    const names = events.map((e) => e.event);
    assert.equal(names[0], "quiz_start");
    assert.ok(names.includes("question_answered"));
    const idx = (n) => names.indexOf(n);
    assert.ok(idx("question_answered") < idx("lead_shown"));
    assert.ok(idx("lead_shown") < idx("lead_submitted"));
    assert.ok(idx("lead_submitted") < idx("result_shown"));
    assert.ok(idx("result_shown") <= idx("funnel_complete"));
    assert.equal(events.find((e) => e.event === "lead_submitted").success, true);
    assert.equal(events.find((e) => e.event === "funnel_complete").leadCaptured, true);
  });

  await check("skip path → emits lead_skipped and funnel_complete(leadCaptured:false)", async () => {
    analytics.resetAnalytics();
    globalThis.fetch = async () => ({ ok: true });
    const root = document.createElement("main");
    const events = [];
    const api = createFunnel(config, root, { submitLead: async () => ({ ok: true }) });
    analytics.registerSink((e) => events.push(e));
    api.start();
    let guard = 0;
    while (api.getView() === "question" && guard++ < 50) {
      api.select(SCRIPT[api.getState().currentStepId]);
      api.next();
    }
    api.getLeadHandle().skip();

    const names = events.map((e) => e.event);
    assert.ok(names.includes("lead_skipped"));
    assert.ok(!names.includes("lead_submitted"));
    assert.equal(events.find((e) => e.event === "funnel_complete").leadCaptured, false);
  });

  if (process.exitCode === 1) console.error("\nFAIL — analytics tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} analytics assertions passed.\n`);
})();
