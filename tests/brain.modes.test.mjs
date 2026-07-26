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
  const withAccount = structuralViolations({ ...r, accountedSkus: r.price_unknown.skus });
  assert.strictEqual(withAccount.length, 0, "clean once accounted: " + JSON.stringify(withAccount));
  const withoutAccount = structuralViolations({ ...r, accountedSkus: [] });
  assert.ok(withoutAccount.some((x) => x.check === "sku_in_leaf"), "canary: without accounting, the no-price SKU would be a silent drop (checker catches it)");
  console.log("PASS — step2 no-price: 'np' accounted in price_unknown, not offered, not a silent drop (checker catches it if unaccounted).");
}
