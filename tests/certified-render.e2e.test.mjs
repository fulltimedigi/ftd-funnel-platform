/**
 * tests/certified-render.e2e.test.mjs — the RENDER-TIME reference monitor, end-to-end through the
 * production render entry (ADR-0037 P0; audit #1/#2/#3/#4/#8). It renders each path into the DOM
 * shim and reads the drawn card, so the fix is CLOSED only if reverting it re-draws a card:
 *   • a proofless (fallback) result → NO card, NO CTA — a terminal screen (kill the global fallback).
 *   • a STALE version set → terminal, no card.
 *   • a missing/edited answer (no rule) → RESTART terminal.
 *   • the CTA points to the PROVEN SKU (not a parent/brand-home url).
 *   • an alternate without a proof is never drawn.
 * Also the POISON-CANARY: breaking the handoff guard must turn a card into a terminal (CI reddener).
 */
import assert from "node:assert/strict";

/* minimal DOM shim (mirrors conversion.test) */
class El {
  constructor(t) { this.tagName = t; this._children = []; this._text = ""; this._attrs = {}; this._listeners = {}; this.className = ""; }
  appendChild(c) { this._children.push(c); return c; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  addEventListener() {}
  set textContent(v) { this._text = String(v); this._children = []; }
  get textContent() { return this._text ? this._text : this._children.map((c) => c.textContent).join(""); }
}
class TextNode { constructor(t) { this._text = String(t); } get textContent() { return this._text; } }
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new TextNode(t) };

const { renderResult } = await import("../engine/resultRenderer.js");
const { handoffTarget } = await import("../engine/kernel/handoff.js");

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

/* tree helpers */
function walk(node, fn) { if (!node || typeof node !== "object") return; fn(node); for (const c of node._children || []) walk(c, fn); }
const hasClass = (root, cls) => { let f = false; walk(root, (n) => { if ((n.className || "").split(" ").includes(cls)) f = true; }); return f; };
const hrefs = (root) => { const out = []; walk(root, (n) => { const h = n._attrs && n._attrs.href; if (h) out.push(h); }); return out; };
const terminalKind = (root) => { let k = null; walk(root, (n) => { if (n._attrs && n._attrs["data-terminal"]) k = n._attrs["data-terminal"]; }); return k; };

const PROVEN = "https://shop.example/products/proven-sku";
const V = { catalog_version: "cat_1.5", policy_version: "pol_1", answer_contract_version: "ans_1", config_hash: "cfg_1", locale_bundle_version: "loc_ar_1" };
function baseConfig() {
  return {
    id: "t", lang: "ar", scoring: { mode: "decision-table" }, resultLayout: "commerce", decisiveResult: true,
    constraintPolicy: [{ id: "format", mode: "NEVER_RELAX", type: "nominal" }],
    ...V,
    signals: [{ id: "s_format", role: "decision" }], questions: [{ id: "q_format" }],
    archetypes: [{ id: "R1", name: "Proven", recommendations: { primary: { name: "Proven Oud", url: PROVEN, price: 500, image: "", becauseTemplate: "الأنسب لك" }, contextual: [] } }],
    decisionTable: [
      { id: "r_0", kind: "COMMERCE", when: { D_format: "oil" }, result: "R1", proof: { product_id: PROVEN, match_state: "EXACT", conflicts: [], unknowns: [] } },
      { id: "r_default", kind: "TERMINAL", when: {}, outcome: "RESTART_REQUIRED" },
    ],
    copy: {}, cta: { primaryUrl: "https://shop.example" /* brand-home — must NEVER be the CTA */ },
  };
}
const resolvedFor = (config, ruleId) => ({ scoring: { mode: "decision-table", ruleId, signals: {} }, primary: config.archetypes[0], proportion: { primaryPct: 100 } });
const render = (config, resolved, clientVersions) => renderResult({ resolved, config, answers: {}, onRestart: () => {}, clientVersions });

check("NORMAL: a proven COMMERCE path draws a card whose CTA is the PROVEN SKU (never brand-home)", () => {
  const config = baseConfig();
  const root = render(config, resolvedFor(config, "r_0"), V);
  assert.ok(hasClass(root, "ftd-signature"), "the recommendation card is drawn");
  const links = hrefs(root);
  assert.ok(links.includes(PROVEN), "CTA points to the proven SKU");
  assert.ok(!links.includes("https://shop.example"), "CTA is NEVER the brand-home fallback url");
  assert.equal(terminalKind(root), null, "not a terminal");
});

check("PROOFLESS fallback → TERMINAL, no card, no CTA (the forbidden global fallback is closed at render)", () => {
  const config = baseConfig();
  config.decisionTable[0].proof = undefined; // strip the ProvenSelection → proofless
  const root = render(config, resolvedFor(config, "r_0"), V);
  assert.ok(!hasClass(root, "ftd-signature"), "NO product card is drawn");
  assert.ok(!hrefs(root).includes(PROVEN), "NO buy CTA");
  assert.equal(terminalKind(root), "NO_MATCH", "a terminal screen is shown instead");
});

check("STALE: a client version mismatch → TERMINAL STALE, no card", () => {
  const config = baseConfig();
  const stale = { ...V, catalog_version: "cat_OLD.9" };
  const root = render(config, resolvedFor(config, "r_0"), stale);
  assert.equal(terminalKind(root), "STALE");
  assert.ok(!hasClass(root, "ftd-signature"));
});

check("RESTART: no rule fired (missing/edited answer) → TERMINAL RESTART_REQUIRED", () => {
  const config = baseConfig();
  const root = render(config, resolvedFor(config, null), V);
  assert.equal(terminalKind(root), "RESTART_REQUIRED");
  assert.ok(!hasClass(root, "ftd-signature"));
});

check("HANDOFF: displayed product ≠ proven SKU → TERMINAL (no composite card)", () => {
  const config = baseConfig();
  config.archetypes[0].recommendations.primary.url = "https://shop.example/products/DIFFERENT";
  const root = render(config, resolvedFor(config, "r_0"), V);
  assert.ok(terminalKind(root), "a terminal is shown, not a card for the wrong SKU");
  assert.ok(!hrefs(root).includes(PROVEN));
});

check("ALTERNATES: an alternate WITHOUT a proof is never drawn; a proven one is", () => {
  const config = baseConfig();
  config.archetypes[0].recommendations.contextual = [
    { name: "Uncertified", url: "https://shop.example/products/no-proof", price: 400, image: "" }, // no proof → dropped
    { name: "Certified Alt", url: "https://shop.example/products/alt-ok", price: 450, image: "", proof: { product_id: "https://shop.example/products/alt-ok", match_state: "EXACT", conflicts: [], unknowns: [] } },
  ];
  const root = render(config, resolvedFor(config, "r_0"), V);
  const links = hrefs(root);
  assert.ok(links.includes("https://shop.example/products/alt-ok"), "the certified alternate is drawn");
  assert.ok(!links.includes("https://shop.example/products/no-proof"), "the uncertified alternate is NOT drawn");
});

check("POISON-CANARY: breaking the handoff guard (unbound SKU) turns the card into a terminal", () => {
  // a product with no deep-linkable url must NOT fall back to brand-home — it becomes HANDOFF_UNBOUND.
  assert.equal(handoffTarget({ name: "x", url: "" }, null).state, "HANDOFF_UNBOUND", "guard: no url → unbound (if this regressed, the E2E below would draw a card)");
  const config = baseConfig();
  config.archetypes[0].recommendations.primary.url = ""; // unbound
  config.decisionTable[0].proof.product_id = ""; // proof matches the (empty) displayed url
  const root = render(config, resolvedFor(config, "r_0"), V);
  assert.ok(terminalKind(root), "an unbound handoff yields a terminal, never a card with a fake/parent link");
  assert.ok(!hasClass(root, "ftd-signature"));
});

if (process.exitCode === 1) console.error("\nFAIL — the render gate let a bad state through.\n");
else console.log(`\nPASS — all ${passed} certified-render E2E assertions passed.\n`);
