/**
 * tests/webhook.test.mjs — Webhook lead sink + configurable lead transport (ADR-0020).
 *
 * Verifies the universal webhook sink (rich payload, honest confirm / no-cors
 * fallback / honest failure, audit copy, placeholder guard) and the fan-out
 * transport (Sheets and/or Webhook, ok-if-any, honest no-endpoint). Offline:
 * fetch + localStorage injected. Exits non-zero on failure.
 */

import assert from "node:assert/strict";

/* --------------------------------------------- localStorage + fetch shims -- */
let _ls = {};
globalThis.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

const { createWebhookSink, isUsableWebhook } = await import("../analytics/webhook-sink.js");
const { createLeadTransport } = await import("../engine/leadTransport.js");

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

const LEAD = { funnelId: "oud", email: "a@b.com", answers: { q_budget: "mid" }, recommended: "Kalimantan Oud Oil", primaryArchetype: "R1", scores: {} };

await (async () => {
  console.log("\nwebhook sink — usability guard:");
  await check("only real http(s) URLs are usable (placeholders rejected)", () => {
    assert.equal(isUsableWebhook("https://hooks.example/abc"), true);
    assert.equal(isUsableWebhook("PASTE_YOUR_WEBHOOK_URL"), false);
    assert.equal(isUsableWebhook("https://x/YOUR_WEBHOOK"), false);
    assert.equal(isUsableWebhook(""), false);
    assert.equal(isUsableWebhook(null), false);
  });
  await check("no usable URL → ok:false, no network call", async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200 }; };
    const r = await createWebhookSink("PASTE_x").submit(LEAD);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no-endpoint");
    assert.equal(called, false);
  });

  console.log("\nwebhook sink — honest delivery:");
  await check("CORS 200 → posts the rich payload and CONFIRMS", async () => {
    let seen = null;
    globalThis.fetch = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200 }; };
    const r = await createWebhookSink("https://hooks.example/abc").submit(LEAD);
    assert.equal(r.ok, true);
    assert.equal(r.confirmed, true);
    assert.equal(seen.url, "https://hooks.example/abc");
    assert.equal(seen.opts.method, "POST");
    assert.ok(seen.opts.body.includes("Kalimantan Oud Oil"), "carries the recommended product");
    assert.ok(seen.opts.body.includes("a@b.com"));
  });
  await check("non-OK status → honest failure (ok:false with status)", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 422 });
    const r = await createWebhookSink("https://hooks.example/abc").submit(LEAD);
    assert.equal(r.ok, false);
    assert.equal(r.status, 422);
  });
  await check("CORS error → no-cors fallback = sent-but-unconfirmed (ok:true, confirmed:false)", async () => {
    let calls = 0;
    globalThis.fetch = async (url, opts) => { calls++; if (calls === 1) throw new TypeError("CORS"); return undefined; };
    const r = await createWebhookSink("https://hooks.example/abc").submit(LEAD);
    assert.equal(r.ok, true);
    assert.equal(r.confirmed, false);
    assert.equal(calls, 2, "tried cors then no-cors");
  });
  await check("hard network failure → ok:false reason network (never fakes success)", async () => {
    globalThis.fetch = async () => { throw new Error("offline"); };
    const r = await createWebhookSink("https://hooks.example/abc").submit(LEAD);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "network");
  });
  await check("keeps a localStorage audit copy of the lead", async () => {
    _ls = {};
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    await createWebhookSink("https://hooks.example/abc").submit({ ...LEAD, funnelId: "aud" });
    const raw = globalThis.localStorage.getItem("ftd:webhook-leads:aud");
    assert.ok(raw && JSON.parse(raw)[0].email === "a@b.com");
  });

  console.log("\nlead transport — fan-out to configured destinations:");
  await check("no destinations → honest no-endpoint", async () => {
    const t = createLeadTransport({ sheetsEndpoint: "PASTE_x", webhookUrl: "" });
    assert.equal(t.sinkCount, 0);
    const r = await t.submit(LEAD);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no-endpoint");
  });
  await check("webhook only → sends to the webhook", async () => {
    let hits = 0;
    globalThis.fetch = async () => { hits++; return { ok: true, status: 200 }; };
    const t = createLeadTransport({ webhookUrl: "https://hooks.example/abc" });
    assert.deepEqual(t.kinds, ["webhook"]);
    const r = await t.submit(LEAD);
    assert.equal(r.ok, true);
    assert.ok(hits >= 1);
  });
  await check("sheets + webhook → fans out to BOTH; ok if any accepts", async () => {
    const urls = [];
    globalThis.fetch = async (url) => { urls.push(url); return { ok: true, status: 200 }; };
    const t = createLeadTransport({ sheetsEndpoint: "https://script.google.com/macros/s/AAA/exec", webhookUrl: "https://hooks.example/abc" });
    assert.deepEqual(t.kinds, ["sheets", "webhook"]);
    const r = await t.submit(LEAD);
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 2);
    assert.ok(urls.some((u) => u.includes("script.google.com")) && urls.some((u) => u.includes("hooks.example")));
  });
  await check("ok if at least one destination accepts (the other failing)", async () => {
    globalThis.fetch = async (url) => (url.includes("hooks.example") ? { ok: true, status: 200 } : (() => { throw new Error("sheets down"); })());
    const t = createLeadTransport({ sheetsEndpoint: "https://script.google.com/macros/s/AAA/exec", webhookUrl: "https://hooks.example/abc" });
    const r = await t.submit(LEAD);
    assert.equal(r.ok, true, "webhook succeeded → lead captured");
  });

  if (process.exitCode === 1) console.error("\nFAIL — webhook tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} webhook assertions passed.\n`);
})();
