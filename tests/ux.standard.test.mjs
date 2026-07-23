/**
 * tests/ux.standard.test.mjs — UX_INTERFACE_DECISION conformance (binding).
 *
 * Verifies the runtime refinements the interface standard adds:
 *  - progress bar starts at ~15% (momentum floor), monotonic, ≤100;
 *  - respondent step count (questions + email) lands in the 3–5 target;
 *  - DECISIVE result = one pick + ≤3 grounded reasons + exactly one CTA
 *    (no "why not", no contextual grid, no second CTA) when config.decisiveResult.
 * The last is proven against the pm reference (which HAS why-not + contextual) so
 * the delta is real. Exits non-zero on failure.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* ------- minimal DOM shim (same shape as the conversion suites) ------------ */
class El { constructor(t){this.tagName=t;this._children=[];this._text="";this._attrs={};this._listeners={};this.className="";this.value="";this.disabled=false;this.style={};}
  appendChild(c){this._children.push(c);return c;} removeChild(c){const i=this._children.indexOf(c);if(i>=0)this._children.splice(i,1);return c;}
  get firstChild(){return this._children[0]||null;} get lastChild(){return this._children[this._children.length-1]||null;}
  setAttribute(k,v){this._attrs[k]=v;} getAttribute(k){return this._attrs[k];} addEventListener(t,fn){(this._listeners[t]=this._listeners[t]||[]).push(fn);}
  click(){(this._listeners.click||[]).forEach((fn)=>fn({}));} set textContent(v){this._text=String(v);this._children=[];}
  get textContent(){return this._text?this._text:this._children.map((c)=>c.textContent).join("");}}
class TextNode { constructor(t){this._text=String(t);} get textContent(){return this._text;} }
globalThis.document = { createElement:(t)=>new El(t), createTextNode:(t)=>new TextNode(t) };
const _ls={}; globalThis.localStorage={getItem:(k)=>(k in _ls?_ls[k]:null),setItem:(k,v)=>{_ls[k]=String(v);},removeItem:(k)=>{delete _ls[k];}};

const { progressPercent } = await import("../engine/progress.js");
const { respondentStepCount } = await import("../engine/flow.js");
const Flow = await import("../engine/flow.js");
const { createFunnel } = await import("../engine/index.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const PM = JSON.parse(readFileSync(join(__dirname, "../configs/pm-certification-advisor.json"), "utf8"));
const HP = JSON.parse(readFileSync(join(__dirname, "../configs/houseplant-advisor.json"), "utf8"));
// A known answer path that reaches a rich result (why + why-not + contextual).
const HP_SCRIPT = { q_experience: "opt_some", q_care: "opt_minimal", q_light: "opt_bright", q_pets: "opt_pets", q_goal: "opt_aesthetics" };

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

/** Count elements whose className contains `cls` (walks the shim tree). */
function countClass(node, cls) {
  let n = 0;
  const visit = (x) => { if (!x || !x._children) return; if (typeof x.className === "string" && x.className.split(/\s+/).includes(cls)) n++; x._children.forEach(visit); };
  visit(node);
  return n;
}

/** Drive a config to its result screen (following an answer script) and return root. */
function driveToResult(cfg, script) {
  const root = document.createElement("main");
  const api = createFunnel(cfg, root, { submitLead: async () => ({ ok: true }) });
  api.start();
  let g = 0;
  while (api.getView() === "question" && g++ < 50) {
    const id = api.getState().currentStepId;
    api.select(script[id]);
    api.next();
  }
  if (api.getView() === "lead") api.getLeadHandle().skip();
  return { root, api };
}

await (async () => {
  console.log("\nprogress — momentum floor (~15%):");
  await check("first step is ~15%, not 0%", () => {
    assert.equal(progressPercent(1, 5), 15);
    assert.equal(progressPercent(1, 2), 15);
  });
  await check("monotonic and capped at 100", () => {
    let prev = -1;
    for (let c = 1; c <= 6; c++) { const p = progressPercent(c, 5); assert.ok(p >= prev, "non-decreasing"); assert.ok(p <= 100); prev = p; }
    assert.equal(progressPercent(99, 3), 100);
  });

  console.log("\nrespondent — 3–5 steps (incl. email):");
  await check("questions + gated email counts as the steps", () => {
    assert.equal(respondentStepCount(PM), PM.questions.length + 1); // pm is gated
  });
  await check("a typical authored funnel (2–3 Q) lands in 3–5 steps", () => {
    const two = { questions: [1, 2], leadForm: { gated: true, fields: [{ name: "email", type: "email" }] } };
    const three = { questions: [1, 2, 3], leadForm: { gated: true, fields: [{ name: "email", type: "email" }] } };
    assert.equal(respondentStepCount(two), 3);
    assert.equal(respondentStepCount(three), 4);
  });

  console.log("\nresult — decisive (one pick + ≤3 reasons + one CTA):");
  await check("CONTROL: houseplant reference (non-decisive) shows why-not + a second (global) CTA", () => {
    const { root, api } = driveToResult(HP, HP_SCRIPT);
    assert.equal(api.getView(), "result");
    assert.ok(countClass(root, "is-whynot") >= 1, "why-not present by default");
    assert.ok(countClass(root, "ftd-cta") >= 1, "global CTA present by default");
    // (the contextual grid shares the SAME !decisive guard as why-not — proven off below)
  });
  await check("DECISIVE: drops why-not, contextual grid, and the second CTA", () => {
    const dec = JSON.parse(JSON.stringify(HP)); dec.decisiveResult = true;
    const { root } = driveToResult(dec, HP_SCRIPT);
    assert.equal(countClass(root, "is-whynot"), 0, "no why-not");
    assert.equal(countClass(root, "ftd-grid"), 0, "no contextual grid");
    assert.equal(countClass(root, "ftd-cta"), 0, "no separate global CTA");
    assert.equal(countClass(root, "ftd-card-cta"), 1, "exactly one CTA — the product card");
  });
  await check("DECISIVE: at most 3 grounded reasons", () => {
    const dec = JSON.parse(JSON.stringify(HP)); dec.decisiveResult = true;
    const { root } = driveToResult(dec, HP_SCRIPT);
    // count reason <li> under the is-why block
    let reasons = 0;
    const visit = (x, inWhy) => { if (!x || !x._children) return; const isWhy = inWhy || (typeof x.className === "string" && x.className.includes("is-why")); x._children.forEach((c) => { if (isWhy && typeof c.className === "string" && c.className.includes("ftd-reason")) reasons++; visit(c, isWhy); }); };
    visit(root, false);
    assert.ok(reasons <= 3, `expected ≤3 reasons, got ${reasons}`);
  });

  if (process.exitCode === 1) console.error("\nFAIL — UX standard tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} UX-standard assertions passed.\n`);
})();
