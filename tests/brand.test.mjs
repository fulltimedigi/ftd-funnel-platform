/**
 * tests/brand.test.mjs — deterministic brand auto-styling (ADR-0028, Track B).
 * Extracts logo + palette from site HTML; maps to :root theme vars; engine applies them.
 */

import assert from "node:assert/strict";
import { extractBrand, brandToThemeVars } from "../authoring/brand/extractBrand.js";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

const HTML = `<!doctype html><html><head>
  <meta name="theme-color" content="#e2c97e">
  <meta property="og:image" content="/img/logo.png">
  <link rel="apple-touch-icon" href="/img/touch.png">
  <style>
    :root{ --c: #e2c97e; }
    .a{ color:#e2c97e } .b{ background:#e2c97e } .c{ border:1px solid #3a2f1e }
    .bg{ background:#f5f0e8 } .hdr{ color:#ffffff } .footer{ color:#000000 }
  </style>
</head><body><img class="site-logo" src="/logo.svg" alt="logo"></body></html>`;

console.log("\nbrand extraction:");

check("theme-color drives the primary; logo resolves to an absolute URL", () => {
  const b = extractBrand(HTML, "https://oud-factory.example");
  assert.equal(b.colors.primary, "#e2c97e");
  assert.equal(b.logo, "https://oud-factory.example/img/logo.png"); // og:image wins
});

check("picks a light background hex present in the page, skips pure white/black", () => {
  const b = extractBrand(HTML, "https://s.example");
  assert.equal(b.colors.bg, "#f5f0e8");
  assert.notEqual(b.colors.primary, "#ffffff");
  assert.notEqual(b.colors.primary, "#000000");
});

check("no signals → safe defaults, never throws", () => {
  const b = extractBrand("<html><head></head><body>plain</body></html>", "https://x.example");
  assert.ok(/^#/.test(b.colors.primary));
  assert.equal(b.logo, "");
});

check("brandToThemeVars maps palette to :root custom properties", () => {
  const vars = brandToThemeVars({ colors: { primary: "#e2c97e", accent: "#3a2f1e", bg: "#f5f0e8", text: "#1f2430" } });
  assert.equal(vars["--brand"], "#e2c97e");
  assert.equal(vars["--cta-bg"], "#e2c97e");
  assert.equal(vars["--bg"], "#f5f0e8");
  assert.equal(vars["--ink"], "#1f2430");
});

/* engine applies themeVars as a :root <style> (DOM shim) */
class El { constructor(t){this.tagName=t;this._children=[];this._attrs={};this._text="";this.style={};this.className="";this.value="";this.disabled=false;}
  appendChild(c){this._children.push(c);return c;} removeChild(c){const i=this._children.indexOf(c);if(i>=0)this._children.splice(i,1);return c;}
  get firstChild(){return this._children[0]||null;} get lastChild(){return this._children[this._children.length-1]||null;}
  setAttribute(k,v){this._attrs[k]=v;} getAttribute(k){return this._attrs[k];} addEventListener(){}
  set textContent(v){this._text=String(v);this._children=[];} get textContent(){return this._text?this._text:this._children.map((c)=>c.textContent).join("");} }
class TextNode { constructor(t){this._text=String(t);} get textContent(){return this._text;} }
const { createFunnel } = await import("../engine/index.js");
check("engine injects a :root brand <style> from config.themeVars", () => {
  const styles = [];
  globalThis.document = {
    head: { appendChild: (n) => styles.push(n) },
    createElement: (t) => new El(t),
    createTextNode: (t) => new TextNode(t),
  };
  const cfg = {
    id: "brand-t", brand: { name: "B" }, theme: "platform-clean",
    themeVars: { "--brand": "#e2c97e", "--bg": "#f5f0e8", "--evil": "expression(x)" },
    scoring: { mode: "decision-table" }, questions: [{ id: "q", text: "?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }],
    archetypes: [{ id: "R1", name: "R", recommendations: { primary: { name: "P", url: "u", becauseTemplate: "x" } } }, { id: "R2", name: "R", recommendations: { primary: { name: "P2", url: "u2", becauseTemplate: "y" } } }],
    resultLayout: "commerce", leadForm: {}, cta: { primaryLabel: "go", primaryUrl: "u" }, analytics: {},
  };
  const root = new El("main");
  createFunnel(cfg, root, { submitLead: async () => ({ ok: true }) });
  const brandStyle = styles.find((s) => s.getAttribute && s.getAttribute("data-ftd-brand"));
  assert.ok(brandStyle, "a brand style tag was injected");
  assert.ok(brandStyle.textContent.includes("--brand:#e2c97e"));
  assert.ok(brandStyle.textContent.includes("--bg:#f5f0e8"));
  assert.ok(!brandStyle.textContent.includes("expression"), "unsafe value is filtered out");
  delete globalThis.document;
});

if (process.exitCode === 1) console.error("\nFAIL — brand tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} brand assertions passed.\n`);
