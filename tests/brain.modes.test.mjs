/**
 * tests/brain.modes.test.mjs — acceptance canaries for the funnel MODES (gold doesn't cover them; oudfactory
 * is a d*≥2 quiz). Criteria are declared in audits/.../modes-acceptance.md and asserted here.
 * Step 2 (no-price) lands first; d* modes (grid/selector/recommendation-light) are added as they are built.
 */
import assert from "node:assert";
import { discoverAxisContracts } from "../authoring/brain/axisContracts.js";
import { assignAxisRoles } from "../authoring/brain/axisRoles.js";
import { buildDecisionTree } from "../authoring/brain/decisionTree.js";
import { craft } from "./lib/realCatalog.mjs";
import { structuralViolations } from "./lib/structuralChecks.js";

async function brain(families) {
  const { familyMatrix, skuMatrix } = await craft(families);
  const axes = assignAxisRoles(discoverAxisContracts(familyMatrix, skuMatrix).published, familyMatrix);
  const r = buildDecisionTree(axes, familyMatrix, skuMatrix);
  return { familyMatrix, skuMatrix, axes, ...r };
}
const leafFamilies = (r) => new Set(r.leaves.flatMap((l) => l.items.map((i) => i.family)));

// ── STEP 2: NO-PRICE PRODUCT — accounted, never in a band, no active CTA, no disappearance ──
{
  const r = await brain([
    { handle: "a1", title: "A One", type: "TypeA", variants: [{ title: "s", price: "10" }] },
    { handle: "a2", title: "A Two", type: "TypeA", variants: [{ title: "s", price: "20" }] },
    { handle: "b1", title: "B One", type: "TypeB", variants: [{ title: "s", price: "30" }] },
    { handle: "b2", title: "B Two", type: "TypeB", variants: [{ title: "s", price: "40" }] },
    { handle: "np", title: "No Price Item", type: "TypeA", variants: [{ title: "s", price: "" }] }, // no price
  ]);
  // accounted (not vanished)
  assert.ok(r.price_unknown.families.includes("np"), "no-price family is accounted in price_unknown");
  assert.ok(r.price_unknown.skus.length >= 1, "no-price family's SKU is accounted");
  // never in a band / not offered (no active CTA path)
  assert.ok(!leafFamilies(r).has("np"), "no-price family is NOT offered in any leaf (never satisfies a band, no active CTA)");
  // NOT a silent drop: the checker is clean ONLY because the SKU is accounted
  const withAccount = structuralViolations({ ...r, accountedSkus: r.accounted_skus });
  assert.strictEqual(withAccount.length, 0, "clean once accounted: " + JSON.stringify(withAccount));
  const withoutAccount = structuralViolations({ ...r, accountedSkus: [] });
  assert.ok(withoutAccount.some((x) => x.check === "sku_in_leaf"), "canary: without accounting, the no-price SKU would be a silent drop (checker catches it)");
  console.log("PASS — step2 no-price: 'np' accounted in price_unknown, not offered, not a silent drop (checker catches it if unaccounted).");
}

const questionCount = (n) => n.kind === "leaf" ? 0 : 1 + Math.max(0, ...n.options.map((o) => questionCount(o.child)));
const allSkusReachable = (r) => { const leafSku = new Set(r.leaves.flatMap((l) => l.skus)); return r.skuMatrix.every((s) => leafSku.has(s.sku_id) || r.accounted_skus.includes(s.sku_id)); };

// ── STEP 3: SINGLE SELECTOR (d*=1) — single product_type, real price spread ⇒ exactly ONE question ──
{
  const r = await brain([
    { handle: "g1", title: "Gadget One", type: "Gadget", variants: [{ title: "s", price: "10" }] },
    { handle: "g2", title: "Gadget Two", type: "Gadget", variants: [{ title: "s", price: "50" }] },
    { handle: "g3", title: "Gadget Three", type: "Gadget", variants: [{ title: "s", price: "90" }] },
  ]);
  assert.strictEqual(r.mode, "selector", "single product_type + price spread ⇒ selector (d*=1)");
  assert.strictEqual(r.d_star, 1, "d*=1");
  assert.strictEqual(questionCount(r.tree), 1, "selector asks EXACTLY one question");
  assert.strictEqual(r.tree.axis, "price", "the one question is the single usable axis (price)");
  assert.ok(allSkusReachable(r), "selector: every SKU reachable");
  console.log("PASS — step3 selector (d*=1): single product_type ⇒ exactly one price question, no degenerate node.");
}

// ── STEP 4: RECOMMENDATION-LIGHT / GRID (d*=0) — no usable axis ⇒ no question, honest direct display ──
{
  const r = await brain(Array.from({ length: 7 }, (_, i) => ({ handle: "u" + i, title: "Item " + i, type: "Item", variants: [{ title: "s", price: "100" }] })));
  assert.strictEqual(r.mode, "recommendation_light", "no usable axis ⇒ recommendation-light (d*=0)");
  assert.strictEqual(r.d_star, 0, "d*=0");
  assert.strictEqual(questionCount(r.tree), 0, "recommendation-light asks ZERO questions (no degenerate node)");
  assert.strictEqual(r.tree.kind, "leaf", "recommendation-light is a single honest display leaf");
  assert.ok(r.tree.note, "recommendation-light carries explicit shopper text");
  assert.ok(allSkusReachable(r), "recommendation-light: EVERY SKU reachable (ق2 not suspended)");
  // oversized-leaf policy applies here too (7 > cap 5 ⇒ comparison grid, nothing hidden)
  assert.strictEqual(r.tree.display, "comparison_grid", "oversized recommendation-light ⇒ comparison grid (no hidden ties)");
  assert.strictEqual(r.tree.items.length, r.tree.count, "recommendation-light hides nothing");
  console.log("PASS — step4 recommendation-light (d*=0): zero questions, every SKU reachable, oversized ⇒ comparison grid.");
}

