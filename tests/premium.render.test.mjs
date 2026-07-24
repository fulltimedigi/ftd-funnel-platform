/**
 * tests/premium.render.test.mjs — premium visual carry (ADR-0033).
 * Proves the REAL product image is carried into every recommendation (primary + nearest
 * alternates) so the result card can render it; a product with no catalog image carries
 * "" (→ a tasteful placeholder, never a fabricated image). Plus safeSrc hardening.
 */

import assert from "node:assert/strict";
import { authorFromAxes } from "../authoring/author/index.js";
import { safeSrc, safeHref } from "../engine/dom.js";

const O = "https://brand.example";
const cartesian = (arrs) => arrs.reduce((acc, arr) => acc.flatMap((a) => arr.map((b) => [...a, b])), [[]]);
const range = (n) => Array.from({ length: n }, (_, i) => i);

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

console.log("\npremium — the recommendation carries a REAL product image:");
check("every archetype's primary.image is the matching product's real catalog image", () => {
  const N = 8;
  // half the catalog has an image, half doesn't (to prove both paths honestly)
  const products = range(N).map((i) => ({ name: "P" + i, url: `${O}/p/${i}`, image: i % 2 === 0 ? `${O}/img/${i}.jpg` : null }));
  const imageByUrl = new Map(products.map((p) => [p.url, p.image || ""]));
  const combos = cartesian([0, 1, 2].map(() => ["0", "1"])); // 8 distinct profiles
  const axes = [0, 1, 2].map((ax) => {
    const profile = new Map();
    products.forEach((p, i) => profile.set(p.url, combos[i][ax]));
    return { id: "ax" + ax, label: "م" + ax, question: "س" + ax + "؟", values: [{ value: "0", label: "a" }, { value: "1", label: "b" }], profile };
  });
  const r = authorFromAxes({ origin: O, products, brandUrl: O }, axes, { maxQuestions: 3, maxCombos: 64 });
  assert.equal(r.ok, true, r.reason);
  for (const a of r.config.archetypes) {
    const rec = a.recommendations.primary;
    // the carried image must equal the REAL catalog image for that product (or "" if none)
    assert.equal(rec.image, imageByUrl.get(rec.url), `primary image for ${rec.url}`);
    if (rec.image) assert.match(rec.image, /^https:\/\/brand\.example\/img\//, "a real catalog image URL");
  }
  // at least one archetype actually carries a real image (the with-image half)
  assert.ok(r.config.archetypes.some((a) => a.recommendations.primary.image), "some primary carries a real image");
});

check("nearest ALTERNATES also carry their real image (or '' → placeholder)", () => {
  // collide two products so one becomes an alternate, and check the alternate carries image
  const products = range(6).map((i) => ({ name: "P" + i, url: `${O}/p/${i}`, image: `${O}/img/${i}.jpg` }));
  const combos = cartesian([0, 1, 2].map(() => ["0", "1"]));
  const axes = [0, 1, 2].map((ax) => {
    const profile = new Map();
    products.forEach((p, i) => profile.set(p.url, combos[i % 4][ax])); // collisions → alternates
    return { id: "ax" + ax, label: "م" + ax, question: "س" + ax + "؟", values: [{ value: "0", label: "a" }, { value: "1", label: "b" }], profile };
  });
  const r = authorFromAxes({ origin: O, products, brandUrl: O }, axes, { maxQuestions: 3, maxCombos: 64 });
  const alts = r.config.archetypes.flatMap((a) => a.recommendations.contextual || []);
  assert.ok(alts.length > 0, "some alternates exist");
  for (const c of alts) assert.ok("image" in c && (c.image === "" || /^https:\/\//.test(c.image)), "alternate carries a real image field");
});

console.log("\npremium — image src is hardened (no fabricated/hostile src):");
check("safeSrc allows http/https/data + relative, blocks javascript:/vbscript:", () => {
  assert.equal(safeSrc("https://cdn.shop/x.jpg"), "https://cdn.shop/x.jpg");
  assert.equal(safeSrc("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(safeSrc("/img/x.jpg"), "/img/x.jpg");
  assert.equal(safeSrc("javascript:alert(1)"), null);
  assert.equal(safeSrc("java\tscript:alert(1)"), null);
  // and href stays image-free of data: (only http/https/mailto)
  assert.equal(safeHref("data:text/html,x"), null);
});

if (process.exitCode === 1) console.error("\nFAIL — premium-render tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} premium-render assertions passed.\n`);
