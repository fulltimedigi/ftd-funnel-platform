/**
 * tests/conversion.test.mjs — STEP 10 Lead Capture & Conversion (end-to-end).
 *
 * Run: node tests/conversion.test.mjs
 *
 * Drives the assembled PM Certification Advisor through the REAL controller
 * (hero → questions → lead → submit) and verifies:
 *   1. RUNNABLE — the full config is schema-complete and the funnel runs.
 *   2. CONVERSION — the captured lead is tagged with WHICH recommendation it
 *      converted on (cert name), the firing rule, and the derived signals.
 *   3. SHORT-CIRCUIT — a PMP holder skips the gate questions and still converts.
 *   4. UI — the result screen actually renders the why / next-step value layer.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* ----- minimal DOM + localStorage shim (mirrors leadloop.test) ----- */
class El {
  constructor(t) { this.tagName = t; this._children = []; this._text = ""; this._attrs = {}; this._listeners = {}; this.className = ""; this.value = ""; this.disabled = false; }
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
globalThis.localStorage = { getItem: (k) => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); }, removeItem: (k) => { delete _ls[k]; } };
const tick = () => new Promise((r) => setTimeout(r, 0));

const { createFunnel } = await import("../engine/index.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(join(__dirname, "../configs/pm-certification-advisor.json"), "utf8"));

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

/** Drive the funnel to the lead step using a per-question answer script. */
function runToLead(script, deps) {
  const root = document.createElement("main");
  const api = createFunnel(CFG, root, deps);
  api.start();
  let guard = 0;
  while (api.getView() === "question" && guard++ < 50) {
    const qid = api.getState().currentStepId;
    api.select(script[qid]);
    api.next();
  }
  return { root, api };
}

await (async () => {
  /* 1 — runnable / schema-complete */
  console.log("\nRunnable — full config is schema-complete:");
  await check("all schema-required top-level keys present", () => {
    for (const k of ["id", "brand", "theme", "lang", "hero", "scoring", "questions", "archetypes", "resultLayout", "leadForm", "cta", "analytics"]) {
      assert.ok(CFG[k] != null, `missing "${k}"`);
    }
    assert.equal(CFG.scoring.mode, "decision-table");
    assert.ok(CFG.leadForm.fields.length >= 2);
    assert.ok(CFG.cta.primaryUrl);
  });

  /* 2 — conversion: lead tagged with the recommendation */
  console.log("\nConversion — the lead carries WHICH recommendation converted:");
  await check("R3 persona: payload has recommended cert + rule + signals", async () => {
    const captured = [];
    const fake = async (p) => { captured.push(p); return { ok: true }; };
    const { api } = runToLead(
      { q_credential: "opt_none", q_qualification: "opt_bachelor", q_hours: "opt_4500_7499", q_environment: "opt_private", q_goal: "opt_promotion" },
      { submitLead: fake }
    );
    assert.equal(api.getView(), "lead");
    api.getLeadHandle().fill({ name: "أحمد", email: "Ahmed@Example.com" });
    api.getLeadHandle().submit();
    await tick();

    assert.equal(captured.length, 1);
    const p = captured[0];
    assert.equal(p.funnelId, "pm-certification-advisor");
    assert.equal(p.primaryArchetype, "R3");
    assert.equal(p.decisionRule, "r7_none_meets");
    assert.ok(p.recommended && p.recommended.includes("PMP"));
    assert.equal(p.signals.DS2, "meets");
    assert.equal(p.dedupeKey, "ahmed@example.com");
    assert.equal(api.getView(), "result");
  });

  /* 3 — short-circuit through the real controller */
  console.log("\nShort-circuit — PMP holder skips the gate, still converts:");
  await check("opt_pmp jumps past qualification/hours; lands R6", async () => {
    const captured = [];
    const { api } = runToLead(
      { q_credential: "opt_pmp", q_environment: "opt_gov", q_goal: "opt_promotion" },
      { submitLead: async (p) => { captured.push(p); return { ok: true }; } }
    );
    // qualification & hours were never asked
    assert.equal(api.getState().answers.q_qualification, undefined);
    assert.equal(api.getState().answers.q_hours, undefined);
    api.getLeadHandle().fill({ name: "سارة", email: "sara@example.com" });
    api.getLeadHandle().submit();
    await tick();
    assert.equal(captured[0].primaryArchetype, "R6");
    assert.ok(captured[0].recommended.includes("MSP")); // gov variant
  });

  /* 4 — the result UI renders the value layer */
  console.log("\nUI — the result screen renders the why / next-step layer:");
  await check("result text includes the why-title, next-title, and a reason", () => {
    const { root, api } = runToLead(
      { q_credential: "opt_none", q_qualification: "opt_bachelor", q_hours: "opt_4500_7499", q_environment: "opt_gov", q_goal: "opt_mobility" },
      { submitLead: async () => ({ ok: true }) }
    );
    api.getLeadHandle().skip(); // straight to result
    assert.equal(api.getView(), "result");
    const t = root.textContent;
    assert.ok(t.includes(CFG.copy.result.whyTitle), "missing why section");
    assert.ok(t.includes(CFG.copy.result.nextTitle), "missing next-step section");
    assert.ok(t.includes("PRINCE2"), "gov R3 should name PRINCE2 as a rejected alternative");
  });

  if (process.exitCode === 1) console.error("\nFAIL — conversion tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} conversion assertions passed.\n`);
})();
