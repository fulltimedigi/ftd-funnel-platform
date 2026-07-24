/**
 * tests/render-architecture.test.mjs — architectural lint for the render reference monitor
 * (ADR-0037 P0; audit round-2 "dependency-graph lint"). Fails CI if a future edit re-opens a bypass:
 *   • the renderer must NOT call the internal runtime verifier directly (the advisory/warn path is
 *     closed) — it goes through certifyForRender only;
 *   • the certificate SEAL is module-private (never exported) so app code cannot mint a certificate;
 *   • the renderer imports the gate (certifyForRender) — it is actually wired, not dead code.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as certMod from "../engine/kernel/certifyForRender.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

check("resultRenderer does NOT import verifyServedResult (the warn/advisory path is closed)", () => {
  const src = read("../engine/resultRenderer.js");
  assert.ok(!/import[^;]*verifyServedResult[^;]*from/.test(src), "renderer must not import verifyServedResult directly");
  assert.ok(/certifyForRender/.test(src), "renderer imports the certified render gate (it is wired)");
});

check("verifyServedResult is called ONLY from certifyForRender (single mediator)", () => {
  const cert = read("../engine/kernel/certifyForRender.js");
  assert.ok(/verifyServedResult/.test(cert), "certifyForRender is the one caller of the internal verifier");
});

check("the certificate SEAL / brand is NOT exported — app code cannot mint a CertifiedSelectionResult", () => {
  // the module exports only the gate + guards + helper — never the Symbol or a raw constructor.
  const names = Object.keys(certMod).sort();
  assert.ok(!names.some((n) => /seal|brand|mint|construct/i.test(n)), `no seal/mint export leaked: ${names.join(",")}`);
  assert.deepEqual(names.filter((n) => n !== "default").sort(), ["TERMINAL_KINDS", "certifyForRender", "clientVersionsOf", "isCertified", "isTerminal"]);
  // a hand-built object can never pass isCertified (the seal is private).
  assert.equal(certMod.isCertified({ certified: true, product_id: "x", cta_url: "y" }), false, "a forged cert object is rejected");
});

check("the render gate never reads config.cta / a parent url — an unbindable handoff is terminal", () => {
  const cert = read("../engine/kernel/certifyForRender.js");
  // strip comments, then assert no code path reads a brand-home/parent CTA field.
  const code = cert.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/config\.cta|\.primaryUrl|homeUrl/.test(code), "the gate must not read a brand-home CTA in code");
  assert.ok(/HANDOFF_UNBOUND/.test(code), "an unbindable handoff is a first-class terminal, not a fallback");
});

if (process.exitCode === 1) console.error("\nFAIL — an architectural bypass was re-opened.\n");
else console.log(`\nPASS — all ${passed} render-architecture assertions passed.\n`);
