/**
 * tests/brain2.remeasure.test.mjs — measure the P1 tree brain (brain2) on the FROZEN gold (delivery step 3.1).
 * ===========================================================================================================
 * The operator's blocking-first check: the six numbers 11/11·0·0 were measured on `authoring/brain` — NOT on
 * `brain2` (the tree the structural compiler consumes). Before wiring brain2 into production, measure BRAIN2 on
 * the same frozen gold, and let THAT number — not brain's — be the step-6 target. Show any difference; do NOT
 * fix it (the frozen-gold pledge stands).
 *
 * FINDING (structural, not an adapter artifact): brain2's tree (buildFullTree / v10) offers ZERO ق2 mandatory
 * "any" reachability branches and NO low-budget band (only {mid, high}, band-exact — not a ceiling). The gold
 * has 9 origin="any" intents and 9 low-budget (ceiling=0) intents. So brain2 cannot route them the way brain's
 * tree does. This is a BLOCKING difference: wiring brain2 as-is would REGRESS the six numbers. Shown, not fixed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree } from "../authoring/brain2/tree.js";
import { select } from "../engine/kernel/constraintKernel.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";
import { scoreAgainstGold } from "./lib/evalScorer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "gold-set.json"), "utf8"));
const FB = { perfume: "Perfumes", oil: "Oud Based Oil Creations", raw: "Agarwood", bundle: "Packages" };
const BANDS = ["low", "mid", "high"];

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const inp = await oudOneLevelInputs();
const kc = inp.resolvedContracts.map((c) => ({ id: c.axis_id, type: c.type, mode: c.mode, priority: c.priority, order: c.order, resolved: c.resolved || null }));
const o = new AuthoringOracle({ units: inp.units, resolvedContracts: inp.resolvedContracts, context: inp.context });
const tree = buildFullTree(o, { limits: { ...inp.treeLimits, leaf_primary_cap: inp.leafCaps.primary } });
const originOf = new Map(inp.units.map((u) => [u.id, u.values.origin && u.values.origin.value]));

// ── a FAITHFUL brain2 traversal (mirrors brain's traverse/isElicitable, adapted to brain2's tree) ──
const kids = new Map();
for (const n of tree.nodes) { const ph = n.transition && n.transition.parent_hash; if (ph) { if (!kids.has(ph)) kids.set(ph, []); kids.get(ph).push(n); } }
const axisAt = new Map(tree.internalChoices.map((c) => [c.node.evaluation_hash, c.axisId]));
const isWild = (v) => v == null || v === "any";
function traverse2(answers) {
  let cur = tree.root; const asked = [];
  while (axisAt.has(cur.evaluation_hash)) {
    const ax = axisAt.get(cur.evaluation_hash); asked.push(ax);
    const cs = kids.get(cur.evaluation_hash) || [];
    const want = answers[ax];
    // brain2 has NO wildcard branch: a wildcard/unspecified answer at an asked axis cannot route (ق2 gap).
    if (isWild(want)) { const wc = cs.find((c) => isWild(o.answersOf(c)[ax])); if (!wc) return { routed: false, asked, reason: `no-wildcard-branch:${ax}` }; cur = wc; continue; }
    const nx = cs.find((c) => String(o.answersOf(c)[ax]) === String(want));
    if (!nx) return { routed: false, asked, reason: `value-not-offered:${ax}=${want}` };
    cur = nx;
  }
  return { routed: true, leaf: cur, asked };
}
const answersOf = (c) => ({ type: FB[c.format], budget: BANDS[c.budget_ceiling], origin: c.origin });
const rec = (c) => {
  const r = traverse2(answersOf(c));
  if (!r.routed || !r.leaf) return { no_match: true };
  const sel = select(inp.units, kc, o.answersOf(r.leaf), {});
  if (sel.product_id == null) return { no_match: true };
  const out = { family: sel.product_id };
  if (c.origin && c.origin !== "any" && originOf.get(sel.product_id) !== c.origin) out.disclosure = { fulfilled: ["format", "budget"], unfulfilled: ["origin"], unknown: [] };
  return out;
};
rec.canElicit = (c) => {
  const a = answersOf(c); const r = traverse2(a);
  if (!r.routed) return false;
  const need = ["type"]; if (c.budget_ceiling != null) need.push("budget"); if (c.origin && c.origin !== "any") need.push("origin");
  return need.every((ax) => r.asked.includes(ax));
};

const s = scoreAgainstGold(gold, rec);
// root-cause tally for the unrouted intents
const unroutedReasons = {};
for (const it of gold.intents) { const r = traverse2(answersOf(it.constraints)); if (!r.routed) { const key = r.reason.split(":")[0] + ":" + r.reason.split(":")[1].split("=")[0]; unroutedReasons[key] = (unroutedReasons[key] || 0) + 1; } }

// structural facts about brain2's tree (the ROOT CAUSE — independent of the adapter)
let anyBranches = 0; const budgetVals = new Set();
for (const [h, ax] of axisAt) for (const c of (kids.get(h) || [])) { const v = o.answersOf(c)[ax]; if (isWild(v)) anyBranches++; if (ax === "budget") budgetVals.add(v); }

console.log("\nBRAIN2 six numbers on the frozen gold (the REAL step-6 target — shown as-is):");
console.log(`  exact=${s.cats.exact_fulfillment} honest=${s.cats.honest_no_match} disclosed=${s.cats.disclosed_compromise} silent=${s.cats.silent_compromise} hard=${s.cats.hard_violation} false_no_match=${s.cats.false_no_match} unserved=${s.unserved}  (N=${s.N})`);
console.log(`  vs BRAIN target: exact=11/ceiling=11 · silent=0 · hard=0 · false_no_match=0 — brain2 DIFFERS.`);
console.log(`  ROOT CAUSE — brain2 tree: ق2 "any" branches=${anyBranches} (brain requires them), budget bands offered={${[...budgetVals].join(",")}} (no "low"; band-exact, not a ceiling).`);
console.log(`  unrouted intents by reason: ${JSON.stringify(unroutedReasons)}`);

check("MEASURED, NOT ASSUMED — the denominator is the full frozen gold and every intent is categorized", () => {
  assert.equal(s.N, 27, "denominator = all 27 frozen gold intents (never filtered)");
  assert.equal(s.cats.exact_fulfillment + s.cats.honest_no_match + s.cats.disclosed_compromise + s.cats.silent_compromise + s.cats.hard_violation + s.cats.false_no_match, 27, "every intent categorized");
});

// DIAGNOSTIC (reported, not gated): is brain2 already at brain's gold numbers? Today: NO. The gap is the step-6
// blocker — reported here + in ADR-0067, so the number moves honestly when brain2's tree gains ق2 'any'
// branches + a ceiling budget. NOT asserted (this file must not lock brain2 in as broken, nor go red when fixed).
const meetsBrain = s.gates.exact_meets_ceiling && s.gates.silent_zero && s.gates.hard_zero && s.gates.false_no_match_zero;
console.log(`  ⇒ brain2 meets brain's 11/11·0·0 target? ${meetsBrain ? "YES" : "NO — BLOCKING"}. Root cause: ق2 'any' branches=${anyBranches}, budget bands={${[...budgetVals].join(",")}} (no ceiling/low).`);
console.log(`  ⇒ STOP (step 3.1): wiring brain2 as-is would REGRESS the six numbers. Its tree needs ق2 'any' branches + a ceiling budget FIRST. Shown, NOT fixed (frozen-gold pledge). See ADR-0067.`);

if (process.exitCode === 1) console.error("\nFAIL — measurement/structural check broke.\n");
else console.log(`\nPASS — brain2 measured on the gold (exact=${s.cats.exact_fulfillment}, silent=${s.cats.silent_compromise}, hard=${s.cats.hard_violation}, unserved=${s.unserved}); it does NOT meet brain's 11/11·0·0 — a BLOCKING structural gap (no ق2 'any' branches, no ceiling budget). Shown, not fixed.\n`);
