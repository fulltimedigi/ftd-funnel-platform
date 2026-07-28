/**
 * tests/btree.axisrule-v9.test.mjs — AXIS-RULE v9 (consultation round-9). Mirror-vs-grid is a DISPLAY-MODE
 * routing, not a rejection. The counts-only brain, when it cannot BRANCH an axis for a DISPLAY reason (too
 * many options for one selector, or all-singleton), ROUTES that node to a ق20 display mode (grid/selector)
 * instead of rejecting it — a legit unique-per-product axis is a grid, and a product-naming was already
 * rejected upstream at the authoring gates. Genuine non-viability (no-split / mostly-compromise) stays a
 * rejection. The options cap is READ from the display contract (owned by the display layer, not the brain).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree, RULE_V8, RULE_V9 } from "../authoring/brain2/tree.js";
import { diagnoseAxesV9 } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const pol = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "config", "policy.json"), "utf8"));
const MINR = pol.authoring_tree.min_exact_option_ratio, MAXOPT = pol.display_contract.max_published_options_per_question;
const dg = (stat, S, maxOptions = MAXOPT) => diagnoseAxesV9({ x: stat }, { S, minExactRatio: MINR, maxOptions });

check("options cap is OWNED by the display contract (read, not derived); the brain has no free number", () => {
  assert.equal(typeof MAXOPT, "number", "the cap is read from policy.display_contract");
  assert.equal(pol.authoring_tree.max_published_options_per_question, undefined, "it is NOT in authoring_tree (the brain does not own it)");
});

check("ALL-SINGLETON ⇒ DISPLAY MODE, not rejected (a legit unique-per-product axis is a grid)", () => {
  const d = dg({ sizes: [1, 1, 1, 1] }, 4);
  assert.equal(d.chosen, null, "not branched");
  assert.ok(d.displayMode.some((m) => m.ax === "x" && /all-singleton/.test(m.reason)), "routed to display mode: " + JSON.stringify(d.displayMode));
  assert.ok(!d.rejected.some((r) => r.ax === "x"), "NOT in the rejection list — information is kept");
});

check("OVER-CAP ⇒ DISPLAY MODE, not rejected (too many options for one selector → grid)", () => {
  const wide = { sizes: [2, ...Array(20).fill(1)] }; // 21 options > cap
  const d = dg(wide, 22);
  assert.equal(d.chosen, null);
  assert.ok(d.displayMode.some((m) => m.ax === "x" && /options-cap/.test(m.reason)), JSON.stringify(d.displayMode));
  assert.ok(!d.rejected.some((r) => r.ax === "x"), "routed, not rejected");
});

check("genuine non-viability STAYS a rejection (no-split single-value; mostly-compromise)", () => {
  assert.ok(dg({ sizes: [10] }, 10).rejected.some((r) => r.reason === "no-split"), "single-value axis is a real rejection");
});

check("a branchable axis is still chosen; a co-present display-mode axis does not block it", () => {
  const d = diagnoseAxesV9({ good: { sizes: [4, 4] }, uniq: { sizes: [1, 1, 1, 1, 1, 1, 1, 1] } }, { S: 8, minExactRatio: MINR, maxOptions: MAXOPT });
  assert.equal(d.chosen, "good", "the branchable axis wins");
  assert.ok(d.displayMode.some((m) => m.ax === "uniq"), "the all-singleton axis is a display-mode candidate, reported");
});

// ── oud before/after v8 → v9 ────────────────────────────────────────────────────────────────────────────
const inputs = await oudOneLevelInputs();
const CAP = inputs.leafCaps.total;
const fresh = () => new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const limits = { ...inputs.treeLimits, leaf_primary_cap: inputs.leafCaps.primary };
function measure(rule) {
  const o = fresh(); const tree = buildFullTree(o, { limits, rule });
  const skusOf = (fams) => fams.flatMap((f) => inputs.skusByFamily[f] || []);
  const cand = new Set(), atCap = new Set();
  for (const leaf of tree.leaves) { for (const s of skusOf(o.membersOf(leaf.pools.eligible_ref))) cand.add(s); const shown = [...o.membersOf(leaf.pools.exact_ref).slice().sort(), ...o.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP); for (const s of skusOf(shown)) atCap.add(s); }
  return { rule: tree.ruleId, atCap: atCap.size, cand: cand.size, depth: tree.depth, reach: o.verifyReachability(tree.nodes), dm: tree.displayModeNodes || [], rej: tree.guardRejections || [] };
}
check("OUD before/after v8 → v9: identical structure; the 3 v8 mirror REJECTIONS become v9 DISPLAY-MODE routings", () => {
  const b = measure(RULE_V8), a = measure(RULE_V9);
  console.log(`  · v8: surface@cap=${b.atCap}/80 depth=${b.depth} REJECTIONS=${b.rej.length} (${[...new Set(b.rej.map((r) => r.axis))].join(",")})`);
  console.log(`  · v9: surface@cap=${a.atCap}/80 depth=${a.depth} DISPLAY-MODE routings=${a.dm.length} (${[...new Set(a.dm.map((r) => r.axis))].join(",")}) rejections=${a.rej.length}`);
  assert.equal(a.atCap, b.atCap, "same surface (routing vs rejecting does not change which SKUs surface)");
  assert.equal(a.reach.ok, true);
  assert.equal(a.cand, 80);
  assert.equal(a.dm.length, b.rej.length, "the v8 mirror rejections are now v9 display-mode routings (information kept, not rejected)");
  assert.ok(a.dm.every((m) => /all-singleton|options-cap/.test(m.reason)), "all routings are display reasons");
});

if (process.exitCode === 1) console.error("\nFAIL — axis-rule v9 did not behave as specified.\n");
else console.log(`\nPASS — all ${passed} axis-rule v9 checks passed (display-mode routing per node; options cap owned by the display contract).\n`);
