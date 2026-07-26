/**
 * tests/brain.remeasure.test.mjs — BUILD STEP 6 (blocking): re-measure the tree brain on the signed gold.
 * ---------------------------------------------------------------------------------------------------
 * Asserts the binding ACCEPTANCE INVARIANTS (not a target count — the operator's expectation is not a
 * goal): hard_violation=0, silent_compromise=0, false_no_match=0, exact = gold ceiling (11), no EXACT
 * intent unserved, identity among SERVED (exact+honest+disclosed = served), and anti-starvation
 * category (a) = 0 (an axis dropped though a real candidate exists). canElicit is DERIVED from the
 * published tree (isElicitable) — never a hand-written per-axis rule. Unserved COUNT is reported, not
 * gated (the raw baseline guard conflates category a/b; the precise a=0 is the real starvation check).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";
import { discoverAxisContracts } from "../authoring/brain/axisContracts.js";
import { assignAxisRoles } from "../authoring/brain/axisRoles.js";
import { buildDecisionTree, traverse, isElicitable } from "../authoring/brain/decisionTree.js";
import { scoreAgainstGold } from "./lib/evalScorer.mjs";
import { oudfactory } from "./lib/realCatalog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "gold-set.json"), "utf8"));
const FB = { perfume: "Perfumes", oil: "Oud Based Oil Creations", raw: "Agarwood", bundle: "Packages" };
const BANDS = ["low", "mid", "high"];
// SOURCE = the REAL ingest pipeline; gold is used ONLY for truth (accepted_skus / expected / candidates).
const { familyMatrix: fm, skuMatrix: sm } = await oudfactory();

const axes = assignAxisRoles(discoverAxisContracts(fm, sm).published, fm);
const oa = axes.find((a) => a.axis_key === "origin"); const famOrigin = new Map(); if (oa) for (const v of oa.values) for (const fid of v.families) famOrigin.set(fid, v.value);
const { tree } = buildDecisionTree(axes, fm, sm);

const answersOf = (c) => ({ type: FB[c.format], price: BANDS[c.budget_ceiling], origin: c.origin });
const rec = (c) => {
  const r = traverse(tree, answersOf(c));
  if (!r.leaf || !r.leaf.items.length) return { no_match: true };
  const pick = r.leaf.items[0].family;
  const out = { family: pick };
  if (c.origin && c.origin !== "any" && famOrigin.get(pick) !== c.origin) out.disclosure = { fulfilled: ["format", "budget"], unfulfilled: ["origin"], unknown: [] };
  return out;
};
rec.canElicit = (c) => isElicitable(tree, answersOf(c)); // tree-DERIVED

const s = scoreAgainstGold(gold, rec);
const g = s.gates;

// binding acceptance invariants
assert.strictEqual(s.cats.hard_violation, 0, "hard_violation must be 0 (ق8)");
assert.strictEqual(s.cats.silent_compromise, 0, "silent_compromise must be 0 (ق9)");
assert.strictEqual(s.cats.false_no_match, 0, "false_no_match must be 0");
assert.ok(g.exact_meets_ceiling, `exact must meet the gold ceiling (${s.cats.exact_fulfillment}/${g.exact_ceiling})`);
assert.ok(g.no_exact_in_unserved, "no EXACT-expected intent may be unserved");
assert.ok(g.identity_served, "identity among SERVED: exact+honest+disclosed = served");

// anti-starvation: category (a) [axis dropped though a real serving candidate exists] must be 0
const servingCount = (fmt, org) => gold.family_decision_truth.filter((f) => f.format === fmt && f.origin === org && f.origin_basis === "description").length;
const causeA = s.unservedList.map((u) => gold.intents.find((i) => i.id === u.id))
  .filter((it) => it.constraints.origin !== "any" && servingCount(it.constraints.format, it.constraints.origin) > 0);
assert.strictEqual(causeA.length, 0, "anti-starvation: category (a) must be 0 (else a real axis was dropped): " + causeA.map((i) => i.id).join(", "));

console.log(`PASS — Step 6 re-measure (tree-derived canElicit): exact=${s.cats.exact_fulfillment}/${g.exact_ceiling} · silent=0 · hard=0 · false=0 · identity(served=${g.served})✓ · unserved=${s.unserved} (all category b, a=0).`);
console.log(`  six numbers: exact ${s.cats.exact_fulfillment} · honest ${s.cats.honest_no_match} · disclosed ${s.cats.disclosed_compromise} · silent ${s.cats.silent_compromise} · hard ${s.cats.hard_violation} · unserved ${s.unserved}`);
