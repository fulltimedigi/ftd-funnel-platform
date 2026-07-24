/**
 * tests/presentation.test.mjs — PRESENTATION + HANDOFF are build-verified (ADR-0037 closing, item 2).
 * Locks the by-construction links so they can't regress (and readies them for variants):
 *   • every displayed field (name/price/image/url) of a result comes from ONE real catalog SKU
 *     record — a SelectionResult is never a composite of fields from different records;
 *   • the CTA target is the PROVEN product url, with no silent fallback to a parent/brand-home link;
 *   • a product with no deep-linkable url yields the first-class HANDOFF_UNBOUND state.
 */
import assert from "node:assert/strict";
import { authorFunnel } from "../authoring/author/index.js";
import { handoffTarget } from "../engine/kernel/handoff.js";
import { readFileSync } from "node:fs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const cat = JSON.parse(readFileSync(new URL("./fixtures/oud-shaped.synthetic.json", import.meta.url), "utf8"));
const byUrl = new Map(cat.products.map((p) => [p.url, p]));
const gen = authorFunnel(cat, { brandName: "Oud" });

check("authoring succeeds and yields archetypes", () => {
  assert.equal(gen.ok, true, gen.reason);
  assert.ok(gen.config.archetypes.length > 0);
});

check("every result's name/price/image/url come from ONE real catalog record (non-composite)", () => {
  const fmtPrice = (p) => (p && p.price != null ? `${p.price}${p.currency ? " " + p.currency : ""}` : "");
  for (const a of gen.config.archetypes) {
    const prim = a.recommendations.primary;
    const src = byUrl.get(prim.url);
    assert.ok(src, `primary ${prim.url} is a real catalog product`);
    // each displayed field must equal THAT product's field — never mixed from another SKU
    assert.equal(prim.image || "", src.image || "", `image of ${prim.url} is that SKU's image`);
    assert.equal(prim.price || "", fmtPrice(src), `price of ${prim.url} is that SKU's price`);
    assert.ok(String(prim.name).length > 0 && String(src.name).includes(String(prim.name).slice(0, 8)), "name comes from that SKU");
    for (const c of a.recommendations.contextual || []) {
      const cs = byUrl.get(c.url);
      assert.ok(cs, `alternate ${c.url} is a real catalog product`);
      assert.equal(c.image || "", cs.image || "", "alternate image is its own SKU's");
      assert.equal(c.price || "", fmtPrice(cs), "alternate price is its own SKU's");
    }
  }
});

check("the proof's product and the displayed product are the SAME SKU (proof ⟺ presentation)", () => {
  const archById = new Map(gen.config.archetypes.map((a) => [a.id, a]));
  for (const rule of gen.config.decisionTable) {
    if (!rule.when || !Object.keys(rule.when).length) continue;
    const a = archById.get(rule.result);
    assert.ok(a && a.recommendations.primary.url, "rule resolves to a displayed product");
    assert.ok(byUrl.has(a.recommendations.primary.url), "and that product is a real SKU the proof certified");
  }
});

check("CTA handoff is the PROVEN product url — no parent/brand-home fallback", () => {
  for (const a of gen.config.archetypes) {
    const prim = a.recommendations.primary;
    const h = handoffTarget(byUrl.get(prim.url), null);
    assert.equal(h.state, "BOUND");
    assert.equal(h.url, prim.url, "handoff is the product's own url");
    assert.notEqual(h.url, gen.config.cta.primaryUrl, "never the brand-home CTA url");
  }
});

check("a product with no deep-linkable url → first-class HANDOFF_UNBOUND (no silent parent redirect)", () => {
  assert.equal(handoffTarget({ name: "X", url: "" }, null).state, "HANDOFF_UNBOUND");
  assert.equal(handoffTarget({ name: "X" }, null).state, "HANDOFF_UNBOUND");
  assert.equal(handoffTarget({ url: "not-a-url" }, null).state, "HANDOFF_UNBOUND");
  // a bound variant url wins over the product shell
  assert.equal(handoffTarget({ url: "https://s.example/p/1" }, { id: "v3", url: "https://s.example/p/1?variant=3" }).url, "https://s.example/p/1?variant=3");
});

if (process.exitCode === 1) console.error("\nFAIL — presentation/handoff regressed.\n");
else console.log(`\nPASS — all ${passed} presentation + handoff assertions passed.\n`);
