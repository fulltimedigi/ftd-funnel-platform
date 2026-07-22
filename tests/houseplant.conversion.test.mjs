/**
 * tests/houseplant.conversion.test.mjs — Houseplant Advisor end-to-end.
 * Drives the real controller: runnable config, conversion payload, short-circuit, UI.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

class El { constructor(t){this.tagName=t;this._children=[];this._text="";this._attrs={};this._listeners={};this.className="";this.value="";this.disabled=false;}
  appendChild(c){this._children.push(c);return c;} removeChild(c){const i=this._children.indexOf(c);if(i>=0)this._children.splice(i,1);return c;}
  get firstChild(){return this._children[0]||null;} get lastChild(){return this._children[this._children.length-1]||null;}
  setAttribute(k,v){this._attrs[k]=v;} getAttribute(k){return this._attrs[k];} addEventListener(t,fn){(this._listeners[t]=this._listeners[t]||[]).push(fn);}
  click(){(this._listeners.click||[]).forEach((fn)=>fn({}));} set textContent(v){this._text=String(v);this._children=[];}
  get textContent(){return this._text?this._text:this._children.map((c)=>c.textContent).join("");}}
class TextNode { constructor(t){this._text=String(t);} get textContent(){return this._text;} }
globalThis.document = { createElement:(t)=>new El(t), createTextNode:(t)=>new TextNode(t) };
const _ls={}; globalThis.localStorage={getItem:(k)=>(k in _ls?_ls[k]:null),setItem:(k,v)=>{_ls[k]=String(v);},removeItem:(k)=>{delete _ls[k];}};
const tick=()=>new Promise((r)=>setTimeout(r,0));

const { createFunnel } = await import("../engine/index.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(join(__dirname, "../configs/houseplant-advisor.json"), "utf8"));
let passed = 0;
const check = (n, fn) => Promise.resolve().then(fn).then(()=>{passed++;console.log(`  ✓ ${n}`);}).catch((e)=>{console.error(`  ✗ ${n}\n    ${e.message}`);process.exitCode=1;});

function runToLead(script, deps) {
  const root = document.createElement("main");
  const api = createFunnel(CFG, root, deps);
  api.start();
  let g = 0;
  while (api.getView() === "question" && g++ < 50) { api.select(script[api.getState().currentStepId]); api.next(); }
  return { root, api };
}

await (async () => {
  console.log("\nRunnable — schema-complete:");
  await check("all required top-level keys present + decision-table", () => {
    for (const k of ["id","brand","theme","lang","hero","scoring","questions","archetypes","resultLayout","leadForm","cta","analytics"]) assert.ok(CFG[k]!=null,`missing ${k}`);
    assert.equal(CFG.scoring.mode, "decision-table");
  });

  console.log("\nConversion — lead tagged with the recommendation:");
  await check("payload carries recommended plant + rule + signals", async () => {
    const captured = [];
    const { api } = runToLead(
      { q_experience:"opt_some", q_care:"opt_regular", q_light:"opt_bright", q_pets:"opt_pets", q_goal:"opt_aesthetics" },
      { submitLead: async (p)=>{captured.push(p);return {ok:true};} }
    );
    assert.equal(api.getView(), "lead");
    api.getLeadHandle().fill({ name:"ليلى", email:"Layla@Example.com" });
    api.getLeadHandle().submit();
    await tick();
    const p = captured[0];
    assert.equal(p.funnelId, "houseplant-advisor");
    assert.equal(p.primaryArchetype, "SAFE_FUSSY");
    assert.equal(p.decisionRule, "r2_pets_demanding");
    assert.ok(p.recommended.includes("كالاثيا"));
    assert.equal(p.signals.DS_pets, "pets");
    assert.equal(p.dedupeKey, "layla@example.com");
    assert.equal(api.getView(), "result");
  });

  console.log("\nShort-circuit — thriving skips care + light:");
  await check("opt_thriving jumps to q_pets; lands EXPERT", async () => {
    const captured = [];
    const { api } = runToLead(
      { q_experience:"opt_thriving", q_pets:"opt_nopets", q_goal:"opt_hobby" },
      { submitLead: async (p)=>{captured.push(p);return {ok:true};} }
    );
    assert.equal(api.getState().answers.q_care, undefined);
    assert.equal(api.getState().answers.q_light, undefined);
    api.getLeadHandle().fill({ name:"عمر", email:"omar@example.com" });
    api.getLeadHandle().submit();
    await tick();
    assert.equal(captured[0].primaryArchetype, "EXPERT");
  });

  console.log("\nUI — value layer renders:");
  await check("result text includes why-title, next-title, and the pet-safety why-not", () => {
    const { root, api } = runToLead(
      { q_experience:"opt_some", q_care:"opt_minimal", q_light:"opt_bright", q_pets:"opt_pets", q_goal:"opt_aesthetics" },
      { submitLead: async ()=>({ok:true}) }
    );
    api.getLeadHandle().skip();
    assert.equal(api.getView(), "result");
    const t = root.textContent;
    assert.ok(t.includes(CFG.copy.result.whyTitle));
    assert.ok(t.includes(CFG.copy.result.nextTitle));
    assert.ok(t.includes("سامة")); // toxic-exclusion reasoning rendered
  });

  if (process.exitCode === 1) console.error("\nFAIL\n"); else console.log(`\nPASS — all ${passed} houseplant-conversion assertions passed.\n`);
})();
