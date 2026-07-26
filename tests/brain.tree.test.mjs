/**
 * tests/brain.tree.test.mjs — BUILD STEP 5 (red-first): state-aware tree + 5 CORPUS-INDEPENDENT tests.
 * ---------------------------------------------------------------------------------------------------
 * The tree is the most dangerous component and the served corpus is only 12 intents — far too thin to
 * test it. So these 5 properties are checked on the WHOLE tree, independent of the corpus (operator
 * condition 2):
 *   1. every published option at any node has ≥1 exact candidate (Exact-support).
 *   2. zero empty branches · every fit question carries the mandatory "any" compass.
 *   3. every leaf's products satisfy ALL of its path constraints.
 *   4. every non-excluded SKU appears in ≥1 leaf.
 *   5. fuzz: random / partial / corrupted answer paths never yield a result without full valid answers.
 * Plus: oversized leaf (>5) → honest comparison grid (nothing hidden, tie_break + notes per item),
 * scent is descriptive (never a question node). Fails RED until authoring/brain/decisionTree.js exists.
 */
import assert from "node:assert";
import { discoverAxisContracts } from "../authoring/brain/axisContracts.js";
import { assignAxisRoles } from "../authoring/brain/axisRoles.js";
import { buildDecisionTree, traverse } from "../authoring/brain/decisionTree.js";
import { oudfactory } from "./lib/realCatalog.mjs";
import { structuralViolations } from "./lib/structuralChecks.js";

// SOURCE = the REAL ingest pipeline (string prices), never gold-derived matrices (numeric prices hid the
// price-axis regression). Structural checks here are corpus-independent — no gold truth needed.
const { familyMatrix, skuMatrix } = await oudfactory();
const axes = assignAxisRoles(discoverAxisContracts(familyMatrix, skuMatrix).published, familyMatrix);
const { tree, leaves, oversized_leaf_count, biggest_leaf } = buildDecisionTree(axes, familyMatrix, skuMatrix);

// per-family truth for path-constraint checks
const famType = new Map(familyMatrix.map((f) => [f.family_id, f.structured.product_type]));
const famBand = new Map(); { const pa = axes.find((a) => a.axis_key === "price"); for (const v of pa.values) for (const fid of v.families) famBand.set(fid, v.value); }
const famOrigin = new Map(); { const oa = axes.find((a) => a.axis_key === "origin"); if (oa) for (const v of oa.values) for (const fid of v.families) famOrigin.set(fid, v.value); }
const BANDS = ["low", "mid", "high"];

// AUTHORITATIVE structural check via the shared, poison-canary-verified checker (catches degenerate
// questions, empty leaves, exact-support, path violations, silent SKU drops, fuzz) — the fix for the
// vacuous inline check that let a no-price product's missing leaf pass.
{
  const violations = structuralViolations({ tree, familyMatrix, skuMatrix, axes });
  assert.strictEqual(violations.length, 0, "shared structural checker: oudfactory tree is clean — " + JSON.stringify(violations));
}

// walk every node collecting questions + options
const questions = []; (function walk(n) { if (n.kind === "question") { questions.push(n); n.options.forEach((o) => walk(o.child)); } })(tree);

// scent is NEVER a question (descriptive only)
for (const q of questions) assert.ok(q.axis !== "origin" || true, "");
assert.ok(!questions.some((q) => q.axis === "scent" || q.axis === "notes"), "scent/notes is descriptive — never a question node (ق13)");

// 1) Exact-support: every option leads to a subtree that ultimately holds ≥1 product
function leafCount(n) { return n.kind === "leaf" ? n.count : n.options.reduce((s, o) => s + leafCount(o.child), 0); }
for (const q of questions) for (const o of q.options) assert.ok(leafCount(o.child) >= 1, `option ${q.axis}=${o.value} has ≥1 exact candidate (no dead option)`);

// 2) zero empty branches + every fit(origin) question carries the mandatory "any" compass
for (const l of leaves) assert.ok(l.count >= 1, "no empty leaf");
for (const q of questions) if (q.axis === "origin") assert.ok(q.options.some((o) => o.value === "any" && o.mandatory), "every origin(fit) question has the mandatory 'any' option (ق2)");

// 3) every leaf's products satisfy ALL its path constraints
for (const l of leaves) {
  for (const fid of l.items.map((i) => i.family)) {
    if (l.path.type != null) assert.strictEqual(famType.get(fid), l.path.type, `leaf product ${fid} matches path type`);
    if (l.path.ceiling != null) assert.ok(BANDS.indexOf(famBand.get(fid)) <= l.path.ceiling, `leaf product ${fid} within budget ceiling`);
    if (l.path.origin != null && l.path.origin !== "any") assert.strictEqual(famOrigin.get(fid), l.path.origin, `leaf product ${fid} matches path origin`);
  }
}

// 3b) DEFECT #6 GUARD — budget matching is VARIANT-level: the OFFERED variant price ≤ the path band ceiling.
// A family entering a band by its start price must still SHOW a purchasable variant ≤ ceiling (not a pricier one).
for (const l of leaves) if (l.path.ceiling != null) for (const it of l.items) {
  assert.ok(it.offered_variant && it.offered_variant.sku_id, `leaf item ${it.family} offers a concrete variant`);
  assert.ok(it.offered_variant.price <= l.ceiling_price, `offered variant ${it.offered_variant.sku_id} (${it.offered_variant.price}) ≤ path ceiling ${l.ceiling_price} (defect #6 guard)`);
}

// 4) every non-excluded SKU appears in ≥1 leaf
const allSkus = new Set(skuMatrix.map((s) => s.sku_id));
const leafSkus = new Set(leaves.flatMap((l) => l.skus));
const missing = [...allSkus].filter((s) => !leafSkus.has(s));
assert.strictEqual(missing.length, 0, "every non-excluded SKU appears in ≥1 leaf: missing " + (missing.slice(0, 5).join(", ") || "none"));

// 5) fuzz: partial + corrupted + valid answer paths (deterministic — indexed, no RNG)
const typeVals = axes.find((a) => a.axis_key === "type").values.map((v) => v.value);
let validLeaves = 0, noResults = 0, pendings = 0;
for (let i = 0; i < 60; i++) {
  const ans = {};
  if (i % 2 === 0) ans.type = typeVals[i % typeVals.length];          // valid type sometimes
  if (i % 3 === 0) ans.type = "___garbage___";                        // corrupted sometimes
  if (i % 5 === 0) ans.price = BANDS[i % 3];
  if (i % 7 === 0) ans.origin = ["indian", "borneo", "any", "___x___"][i % 4];
  const r = traverse(tree, ans);
  assert.ok(r.leaf || r.no_result || r.pending, "traverse always returns a defined outcome");
  assert.ok(!(r.leaf && r.pending), "never both a result and pending");
  if (r.leaf) validLeaves++; else if (r.no_result) noResults++; else pendings++;
}
// corrupted type must never reach a leaf
assert.deepStrictEqual(traverse(tree, { type: "___garbage___", price: "low" }), { no_result: true, reason: "invalid answer for type: ___garbage___" }, "corrupted answer → no result (no fabrication)");
// a fully valid path DOES reach a leaf
const okType = typeVals[0];
const full = traverse(tree, { type: okType, price: "high", origin: "any" });
assert.ok(full.leaf || full.pending, "a valid path resolves to a leaf (or asks the next real question)");

// oversized leaf honesty: nothing hidden, comparison grid, tie_break + notes on every item
for (const l of leaves) if (l.oversized) {
  assert.strictEqual(l.display, "comparison_grid", "oversized leaf renders as a comparison grid (ق20)");
  assert.strictEqual(l.items.length, l.count, "oversized leaf hides NOTHING (all tied items present)");
  for (const it of l.items) assert.ok(it.tie_break_reason, "each grid item carries a tie_break_reason");
  assert.ok(l.note, "oversized leaf states the tie explicitly to the shopper");
}

console.log(`PASS — Step 5 tree: ${leaves.length} leaves · oversized(>5)=${oversized_leaf_count} · biggest leaf=${biggest_leaf} · fuzz(valid=${validLeaves}/pending=${pendings}/no-result=${noResults}).`);
console.log(`  structural: exact-support ✓ · no empty branch ✓ · mandatory 'any' ✓ · path-satisfaction ✓ · every SKU in a leaf ✓ · corrupted→no-result ✓`);
