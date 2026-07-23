/**
 * tests/href.test.mjs — href sanitization (ADR-0032).
 * safeHref blocks javascript:/data:/vbscript: (incl. control-char obfuscation) so a
 * poisoned/scraped config can't inject a script URL; http/https/mailto/relative pass.
 */

import assert from "node:assert/strict";
import { safeHref } from "../engine/dom.js";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

console.log("\nhref — blocks dangerous schemes:");
check("javascript: / data: / vbscript: / file: are dropped", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("  JavaScript:alert(1)"), null);
  assert.equal(safeHref("java\tscript:alert(1)"), null);   // control-char obfuscation
  assert.equal(safeHref("java\nscript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,<script>x</script>"), null);
  assert.equal(safeHref("vbscript:msgbox(1)"), null);
  assert.equal(safeHref("file:///etc/passwd"), null);
});

console.log("\nhref — allows safe values:");
check("http/https/mailto and relative/anchor pass through", () => {
  assert.equal(safeHref("https://oudfactory.com/products/x"), "https://oudfactory.com/products/x");
  assert.equal(safeHref("http://shop.example/p"), "http://shop.example/p");
  assert.equal(safeHref("mailto:hi@fulltimedigi.com"), "mailto:hi@fulltimedigi.com");
  assert.equal(safeHref("/products/x"), "/products/x");
  assert.equal(safeHref("#result"), "#result");
  assert.equal(safeHref("?q=1"), "?q=1");
});

if (process.exitCode === 1) console.error("\nFAIL — href tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} href assertions passed.\n`);
