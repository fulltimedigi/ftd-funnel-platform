/**
 * tests/signals.test.mjs — STEP 4 generic signal derivation (engine-level).
 *
 * Run: node tests/signals.test.mjs
 *
 * Tests the funnel-agnostic deriver: identity + cases (+ clamp) rules driven
 * entirely from a config's `derivedSignals`, plus collectRawSignals binding.
 * Funnel-specific derivation correctness is covered by each funnel's decision test.
 */

import assert from "node:assert/strict";
import { deriveSignals, collectRawSignals, applyDerivation } from "../engine/signals.js";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}`); console.error("    " + err.message); process.exitCode = 1; }
}

/* A tiny two-signal fixture exercising every rule kind. */
const CFG = {
  signals: [
    { id: "a", role: "decision", source: "qa", map: {} },
    { id: "b", role: "decision", source: "qb", map: {} },
    { id: "goal", role: "presentation", source: "qg", default: "unsure", map: {} },
  ],
  derivedSignals: [
    { id: "A", from: ["a"], rule: "identity", domain: ["lo", "hi"] },
    {
      id: "B", from: ["a", "b", "c"], rule: "cases", domain: ["meets", "below", "unsure"], default: "below",
      cases: [
        { when: { b: "unsure" }, value: "unsure" },
        { when: { a: "hi", b: ["mid", "max"] }, value: "meets" },
      ],
      clamp: [{ when: { c: "block" }, ifValue: "meets", to: "below" }],
    },
  ],
};

console.log("\napplyDerivation — rule kinds:");
check("identity passes the raw value through", () => {
  assert.equal(applyDerivation(CFG.derivedSignals[0], { a: "hi" }).value, "hi");
});
check("cases: first matching case wins; else default", () => {
  const B = CFG.derivedSignals[1];
  assert.equal(applyDerivation(B, { a: "hi", b: "max" }).value, "meets");
  assert.equal(applyDerivation(B, { a: "hi", b: "lo" }).value, "below");   // no case → default
  assert.equal(applyDerivation(B, { a: "lo", b: "unsure" }).value, "unsure"); // unsure case
});
check("cases: array membership in `when`", () => {
  assert.equal(applyDerivation(CFG.derivedSignals[1], { a: "hi", b: "mid" }).value, "meets");
});
check("clamp overrides the computed value and flags it", () => {
  const r = applyDerivation(CFG.derivedSignals[1], { a: "hi", b: "max", c: "block" }); // computes meets...
  assert.equal(r.value, "below"); // ...then clamped (independent signal)
  assert.equal(r.clamped, true);
});
check("unknown rule throws", () => {
  assert.throws(() => applyDerivation({ rule: "nope", from: [] }, {}));
});

console.log("\nderiveSignals — config-driven, with meta + passthrough:");
check("derives all signals from config.derivedSignals", () => {
  const s = deriveSignals(CFG, { a: "hi", b: "max" });
  assert.equal(s.A, "hi");
  assert.equal(s.B, "meets");
});
check("records clamp events in meta", () => {
  const s = deriveSignals(CFG, { a: "hi", b: "max", c: "block" });
  assert.equal(s.B, "below");
  assert.equal(s.meta.clamped, true);
  assert.deepEqual(s.meta.clamps, ["B"]);
});
check("no clamp → meta.clamped false", () => {
  assert.equal(deriveSignals(CFG, { a: "hi", b: "lo" }).meta.clamped, false);
});
check("presentation signals pass through with their default when absent", () => {
  const s = deriveSignals(CFG, { a: "lo", b: "lo" });
  assert.equal(s.goal, "unsure");
});

console.log("\ncollectRawSignals — answer→canonical binding:");
check("maps option ids to canonical values via config.signals", () => {
  const cfg = { signals: [
    { id: "a", source: "qa", map: { x: "hi", y: "lo" } },
    { id: "goal", source: "qg", default: "unsure", map: { g1: "promo" } },
  ] };
  const raw = collectRawSignals({ qa: "x" }, cfg);
  assert.equal(raw.a, "hi");
  assert.equal(raw.goal, "unsure"); // unanswered → default
});
check("end-to-end: collect → derive", () => {
  const raw = collectRawSignals({ qa: "x", qb: "z" }, {
    signals: [{ id: "a", source: "qa", map: { x: "hi" } }, { id: "b", source: "qb", map: { z: "max" } }],
  });
  const s = deriveSignals(CFG, raw);
  assert.equal(s.B, "meets");
});

if (process.exitCode === 1) console.error("\nFAIL — some signal tests did not pass.\n");
else console.log(`\nPASS — all ${passed} signal assertions passed.\n`);
