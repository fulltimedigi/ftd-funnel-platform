/**
 * tests/platform.intake.test.mjs — Paste-URL intake validation (ADR-0024).
 * The pure gate the entry screen runs before any generation. Honest reject of a
 * bad URL; a bare host is normalized; the optional goal is captured/bounded.
 */

import assert from "node:assert/strict";
import { normalizeUrl, buildIntake } from "../platform/intake/intakeModel.js";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

console.log("\nintake — url normalization:");
check("a bare host gets https:// and lower-cased host", () => {
  assert.equal(normalizeUrl("Brand.com"), "https://brand.com/");
  assert.equal(normalizeUrl("  shop.example/path  "), "https://shop.example/path");
});
check("an explicit scheme is preserved; localhost allowed (our dev/sample)", () => {
  assert.equal(normalizeUrl("http://localhost:8000/examples/sample-shop/"), "http://localhost:8000/examples/sample-shop/");
});
check("junk / non-http / hostless → '' (rejected)", () => {
  assert.equal(normalizeUrl(""), "");
  assert.equal(normalizeUrl("not a url"), "");
  assert.equal(normalizeUrl("ftp://x.com"), "");
  assert.equal(normalizeUrl("javascript:alert(1)"), "");
  assert.equal(normalizeUrl("https://nodothost"), "");
});

console.log("\nintake — buildIntake:");
check("valid url → ok with normalized request; goal optional", () => {
  const r = buildIntake({ url: "brand.com" });
  assert.equal(r.ok, true);
  assert.equal(r.request.url, "https://brand.com/");
  assert.equal(r.request.goal, null);
});
check("captures + bounds the optional business goal", () => {
  const r = buildIntake({ url: "brand.com", goal: "  بيع الخط عالي الربحية  " });
  assert.equal(r.request.goal, "بيع الخط عالي الربحية");
  const long = buildIntake({ url: "brand.com", goal: "x".repeat(500) });
  assert.equal(long.request.goal.length, 200);
});
check("invalid url → honest reject, no request", () => {
  const r = buildIntake({ url: "nope" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid-url");
});

if (process.exitCode === 1) console.error("\nFAIL — intake tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} intake assertions passed.\n`);
