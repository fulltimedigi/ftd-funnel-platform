/**
 * tests/embed.test.mjs — Embed loader + frame reporter pure core (ADR-0021).
 *
 * Covers the security- and correctness-critical logic offline (no DOM):
 *  - buildFrameSrc / isUsableFunnelRef / frameOrigin  (URL construction)
 *  - parseResizeMessage  (the SECURITY GATE: origin + shape + numeric + clamp)
 *  - buildResizeMessage / measureHeight  (frame side)
 * Exits non-zero on failure.
 */

import assert from "node:assert/strict";

const {
  isUsableFunnelRef, buildFrameSrc, frameOrigin, parseResizeMessage,
  RESIZE_TYPE, MAX_FRAME_HEIGHT, FRAME_SANDBOX,
} = await import("../embed/embed.js");
const { buildResizeMessage, measureHeight } = await import("../embed/frame.js");

const LOADER = "https://fulltimedigi.com/embed/embed.js";
let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

await (async () => {
  console.log("\nembed loader — frame src + usability:");
  await check("usable funnel ref rejects empties and placeholders", () => {
    assert.equal(isUsableFunnelRef("pm-certification-advisor"), true);
    assert.equal(isUsableFunnelRef("  "), false);
    assert.equal(isUsableFunnelRef(""), false);
    assert.equal(isUsableFunnelRef(null), false);
    assert.equal(isUsableFunnelRef("PASTE_FUNNEL_ID"), false);
    assert.equal(isUsableFunnelRef("YOUR_FUNNEL"), false);
  });
  await check("funnel id → hosted funnel.html?funnel=<id> next to the loader", () => {
    const src = buildFrameSrc(LOADER, { funnel: "pm-certification-advisor" });
    assert.equal(src, "https://fulltimedigi.com/embed/funnel.html?funnel=pm-certification-advisor");
  });
  await check("explicit config url wins over funnel id", () => {
    const src = buildFrameSrc(LOADER, { funnel: "x", config: "https://t.example/c.json" });
    assert.ok(src.includes("config=https%3A%2F%2Ft.example%2Fc.json"));
    assert.ok(!src.includes("funnel=x"));
  });
  await check("no usable ref → throws (never a bare funnel.html)", () => {
    assert.throws(() => buildFrameSrc(LOADER, { funnel: "PASTE_x" }), /no usable/);
    assert.throws(() => buildFrameSrc(LOADER, {}), /no usable/);
  });
  await check("frameOrigin is the funnel-page origin", () => {
    assert.equal(frameOrigin(buildFrameSrc(LOADER, { funnel: "a" })), "https://fulltimedigi.com");
  });
  await check("sandbox is locked down but allows the funnel to run + store", () => {
    assert.ok(FRAME_SANDBOX.includes("allow-scripts"));
    assert.ok(FRAME_SANDBOX.includes("allow-forms"));
    assert.ok(FRAME_SANDBOX.includes("allow-same-origin"), "needed for localStorage on OUR (cross-origin) frame");
    assert.ok(!FRAME_SANDBOX.includes("allow-top-navigation"), "must not be able to navigate the host");
  });

  console.log("\nembed loader — parseResizeMessage (the security gate):");
  const OK_ORIGIN = "https://fulltimedigi.com";
  const goodMsg = { __ftd: true, type: RESIZE_TYPE, height: 640 };
  await check("valid same-origin resize → clamped height", () => {
    const r = parseResizeMessage({ origin: OK_ORIGIN, data: goodMsg }, OK_ORIGIN);
    assert.deepEqual(r, { height: 640 });
  });
  await check("WRONG origin → rejected (no resize from a spoofed frame)", () => {
    assert.equal(parseResizeMessage({ origin: "https://evil.example", data: goodMsg }, OK_ORIGIN), null);
  });
  await check("substring/near origin → rejected (exact match only)", () => {
    assert.equal(parseResizeMessage({ origin: "https://fulltimedigi.com.evil.io", data: goodMsg }, OK_ORIGIN), null);
  });
  await check("missing __ftd marker → rejected", () => {
    assert.equal(parseResizeMessage({ origin: OK_ORIGIN, data: { type: RESIZE_TYPE, height: 5 } }, OK_ORIGIN), null);
  });
  await check("wrong type → rejected (ignores other chatter on the channel)", () => {
    assert.equal(parseResizeMessage({ origin: OK_ORIGIN, data: { __ftd: true, type: "other", height: 5 } }, OK_ORIGIN), null);
  });
  await check("non-numeric / non-positive height → rejected", () => {
    assert.equal(parseResizeMessage({ origin: OK_ORIGIN, data: { __ftd: true, type: RESIZE_TYPE, height: "big" } }, OK_ORIGIN), null);
    assert.equal(parseResizeMessage({ origin: OK_ORIGIN, data: { __ftd: true, type: RESIZE_TYPE, height: 0 } }, OK_ORIGIN), null);
    assert.equal(parseResizeMessage({ origin: OK_ORIGIN, data: { __ftd: true, type: RESIZE_TYPE, height: -50 } }, OK_ORIGIN), null);
  });
  await check("absurd height is clamped to the ceiling (host page can't be blown up)", () => {
    const r = parseResizeMessage({ origin: OK_ORIGIN, data: { __ftd: true, type: RESIZE_TYPE, height: 1e9 } }, OK_ORIGIN);
    assert.equal(r.height, MAX_FRAME_HEIGHT);
  });
  await check("non-object data / missing event → rejected", () => {
    assert.equal(parseResizeMessage({ origin: OK_ORIGIN, data: "640" }, OK_ORIGIN), null);
    assert.equal(parseResizeMessage(null, OK_ORIGIN), null);
  });

  console.log("\nframe reporter — payload + measurement:");
  await check("buildResizeMessage is the exact namespaced shape (ceil, non-negative)", () => {
    assert.deepEqual(buildResizeMessage(639.2), { __ftd: true, type: RESIZE_TYPE, height: 640 });
    assert.deepEqual(buildResizeMessage(-5), { __ftd: true, type: RESIZE_TYPE, height: 0 });
    assert.deepEqual(buildResizeMessage("x"), { __ftd: true, type: RESIZE_TYPE, height: 0 });
  });
  await check("measureHeight takes the max of the box metrics (never clips a grown funnel)", () => {
    const doc = { body: { scrollHeight: 700, offsetHeight: 650 }, documentElement: { scrollHeight: 720, clientHeight: 500 } };
    assert.equal(measureHeight(doc), 720);
    assert.equal(measureHeight(null), 0);
  });
  // A valid frame message must survive the parent's gate — end-to-end shape contract.
  await check("a message the frame builds passes the loader's gate", () => {
    const msg = buildResizeMessage(measureHeight({ body: { scrollHeight: 812 } }));
    const r = parseResizeMessage({ origin: OK_ORIGIN, data: msg }, OK_ORIGIN);
    assert.deepEqual(r, { height: 812 });
  });

  if (process.exitCode === 1) console.error("\nFAIL — embed tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} embed assertions passed.\n`);
})();
