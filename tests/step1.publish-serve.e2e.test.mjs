/**
 * tests/step1.publish-serve.e2e.test.mjs — STEP 1, RED-FIRST. The certified-render E2E proves the
 * render GATE, but on a HAND-BUILT config, IN-PROCESS. That is the "proven by construction" illusion:
 * proof.product_id === displayed url because the same in-memory object holds both. This suite closes
 * that by:
 *   1. authoring a REAL config from the recorded real oudfactory catalog (string prices), and
 *   2. crossing the REAL persist/serve boundary — recordFrom() → JSON serialize → JSON parse — so the
 *      proof/url match is RE-VERIFIED from serialized bytes, never by a shared reference, and
 *   3. rendering THREE cases through the production render entry (renderResult):
 *        (A) intact authored config      → a product card + a CTA to the proven SKU.
 *        (B) a proof DELETED before serve → a terminal screen, NO card, NO CTA.
 *        (C) proof PRESENT but the displayed product drifted (post-publish edit / catalog drift)
 *            → REJECTED (terminal), NO card, NO CTA.  ← the risk the in-process measurement never touched.
 *   4. the PER-FUNNEL PUBLISH GATE: a config that fails verifyFunnel (proof coverage < 100%) must NOT
 *      be persisted as `ready` (served). recordFrom must fail closed.
 * Stops at the first failing case (assert/strict throws).
 */
import assert from "node:assert/strict";
import fs from "node:fs";

/* minimal DOM shim (mirrors certified-render.e2e) — set BEFORE importing the renderer */
class El {
  constructor(t) { this.tagName = t; this._children = []; this._text = ""; this._attrs = {}; this.className = ""; }
  appendChild(c) { this._children.push(c); return c; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  addEventListener() {}
  set textContent(v) { this._text = String(v); this._children = []; }
  get textContent() { return this._text ? this._text : this._children.map((c) => c.textContent).join(""); }
}
class TextNode { constructor(t) { this._text = String(t); } get textContent() { return this._text; } }
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new TextNode(t) };

const { generateFunnelFromUrl } = await import("../authoring/index.js");
const { recordFrom } = await import("../platform/jobs/generateJob.js");
const { score } = await import("../engine/scoring.js");
const { resolve } = await import("../engine/resolver.js");
const { clientVersionsOf } = await import("../engine/kernel/certifyForRender.js");
const { renderResult } = await import("../engine/resultRenderer.js");

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

/* tree helpers */
function walk(node, fn) { if (!node || typeof node !== "object") return; fn(node); for (const c of node._children || []) walk(c, fn); }
const hasClass = (root, cls) => { let f = false; walk(root, (n) => { if ((n.className || "").split(" ").includes(cls)) f = true; }); return f; };
const hrefs = (root) => { const out = []; walk(root, (n) => { const h = n._attrs && n._attrs.href; if (h) out.push(h); }); return out; };
const terminalKind = (root) => { let k = null; walk(root, (n) => { if (n._attrs && n._attrs["data-terminal"]) k = n._attrs["data-terminal"]; }); return k; };

const URL_ = "https://www.oudfactory.com";
const FIXTURE = fs.readFileSync(new URL("./fixtures/oudfactory.products.json", import.meta.url), "utf8");
const fetcher = {
  userAgent: "step1", setMinDelay() {}, stats: () => ({ requests: 0, maxPages: 200, minDelayMs: 0 }),
  async get(u) {
    if (u.endsWith("/robots.txt")) return { ok: false, url: u, reason: "http-404" };
    if (u.includes("/products.json")) { const p1 = !/[?&]page=([2-9]|\d\d+)/.test(u); return { ok: true, url: u, finalUrl: u, status: 200, text: p1 ? FIXTURE : '{"products":[]}' }; }
    return { ok: true, url: u, finalUrl: u, status: 200, text: "<html></html>" };
  },
};

/** A FRESH record each case — recordFrom returns { config: res.config } BY REFERENCE (no clone), so a
 *  per-case deep clone prevents one case's mutation from leaking into the next (real: the store also
 *  serializes, so a clone is faithful, not a cheat). */
const freshRecord = () => recordFrom({ ...res, config: JSON.parse(JSON.stringify(res.config)) }, URL_);
/** cross the REAL persist/serve boundary: shape the stored record, serialize, deserialize. */
const persistAndServe = () => JSON.parse(JSON.stringify(freshRecord()));
/** build a full answer-path that fires a specific COMMERCE rule (maps when → option ids via signals). */
function pathFor(config, rule) {
  const ans = {};
  for (const q of config.questions) {
    const sig = config.signals.find((s) => s.source === q.id);
    const ds = config.derivedSignals.find((d) => d.from.includes(sig.id));
    const want = rule.when[ds.id];
    const oid = Object.keys(sig.map).find((k) => sig.map[k] === want) || q.options[0].id;
    ans[q.id] = oid;
  }
  return ans;
}
const renderPath = (config, answers) => renderResult({ resolved: resolve(score(config, answers), config), config, answers, onRestart: () => {}, clientVersions: clientVersionsOf(config) });

// ── author ONCE from the real catalog ──
const res = await generateFunnelFromUrl(URL_, { authorized: true, fetcher, currency: "AED" });
assert.ok(res.ok, "authoring succeeded on the real oudfactory catalog");
assert.ok(res.verify && res.verify.ok === true, "authored config passes verifyFunnel (proof coverage 100%)");

// ── (A) intact authored config, SERVED FROM STORAGE → a real card + CTA to the proven SKU ──
check("A · authored → persisted (JSON round-trip) → served: draws a card whose CTA is the proven SKU", () => {
  const served = persistAndServe();
  assert.equal(served.status, "ready", "a gate-passing authored config is persisted ready");
  const config = served.config;
  const rule = config.decisionTable.find((r) => r.kind === "COMMERCE");
  const root = renderPath(config, pathFor(config, rule));
  assert.ok(hasClass(root, "ftd-signature"), "a product card is drawn from the certificate");
  assert.equal(terminalKind(root), null, "not a terminal");
  assert.ok(hrefs(root).includes(rule.proof.product_id), "the CTA points to the PROVEN SKU (from the cert, across storage)");
});

// ── (B) a proof DELETED before serve → terminal, no card, no CTA ──
check("B · proof deleted across storage → terminal screen, NO card, NO CTA", () => {
  const rec = freshRecord();
  const rule = rec.config.decisionTable.find((r) => r.kind === "COMMERCE");
  rule.proof = undefined;                                   // strip the ProvenSelection…
  const served = JSON.parse(JSON.stringify(rec)).config;    // …and cross storage (JSON drops it → proofless)
  const root = renderPath(served, pathFor(served, rule));
  assert.ok(!hasClass(root, "ftd-signature"), "NO product card");
  assert.ok(!hrefs(root).includes(rule.proof && rule.proof.product_id), "NO buy CTA");
  assert.ok(terminalKind(root), "a terminal screen is shown instead");
});

// ── (C) proof PRESENT but displayed product drifted (post-publish edit / catalog drift) → REJECTED ──
check("C · proof intact but displayed product drifted → REJECTED (terminal), NO card, NO CTA — the boundary the in-process measure never touched", () => {
  const rec = freshRecord();
  const config0 = rec.config;
  const rule = config0.decisionTable.find((r) => r.kind === "COMMERCE");
  const provenId = rule.proof.product_id;
  const arch = config0.archetypes.find((a) => a.id === rule.result);
  arch.recommendations.primary.url = "https://drift.example/products/OTHER-SKU"; // displayed ≠ proven (proof unchanged)
  const served = JSON.parse(JSON.stringify(rec)).config;    // cross storage AFTER the drift
  const root = renderPath(served, pathFor(served, rule));
  assert.ok(!hasClass(root, "ftd-signature"), "NO product card for a drifted (unproven) product");
  assert.ok(!hrefs(root).includes(provenId), "NO CTA to the proven SKU (the displayed one drifted away)");
  assert.ok(!hrefs(root).includes("https://drift.example/products/OTHER-SKU"), "NO CTA to the drifted product either");
  assert.ok(terminalKind(root), "the drift is rejected as a terminal, never a composite card");
});

// ── (D) PER-FUNNEL PUBLISH GATE: a config failing verifyFunnel must NOT be persisted as `ready` ──
check("D · publish gate: a config that FAILS verifyFunnel is NOT persisted ready (fail closed)", () => {
  const failing = { ...res, config: JSON.parse(JSON.stringify(res.config)), verify: { ok: false, checked: 0, findings: [{ code: "PROOF_COVERAGE_BELOW_1" }] } };
  const rec = recordFrom(failing, URL_);
  assert.notEqual(rec.status, "ready", "a funnel that fails the proof-coverage gate must NOT be served (publish gate)");
});

if (process.exitCode === 1) console.error("\nFAIL — step-1 publish/serve gate let a bad state through.\n");
else console.log(`\nPASS — all ${passed} step-1 publish/serve E2E assertions passed (real authoring, across storage).\n`);
