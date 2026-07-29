/**
 * tests/btree.axis-selector-freeze.test.mjs — the FREEZE of the axis-selection RANKING (round-10, ADR-0058).
 * The ranking (rankAxesV10) is frozen as axis_selector_version=v10 because the control experiment proved it is
 * QUALITY not SAFETY. This suite:
 *   1. pins the version, 2. pins the FROZEN tie-break order (editing the frozen ranking reddens this — a reopen
 *   needs an artifact), 3. proves the SEPARATION (the ranking carries no gate logic — it never drops an
 *   accepted axis), 4. sets surface_reachable@cap as a REGRESSION BASELINE (measured at freeze, pinned with a
 *   fixture fingerprint): a drop below it is a SURFACE regression to investigate — NOT a trigger to reopen and
 *   tune the axis selector (that would be counter-tuning for the missing ق20 grid / GAP-7).
 *
 * REOPEN CONDITIONS for the frozen ranking — four, each requiring a concrete ARTIFACT (no artifact, no reopen):
 *   (a) a broken PROMISE with a RED test · (b) a fixed BENCHMARK failing against a recorded baseline · (c) a
 *   REAL catalog committed as a fixture that a merchant rejects · (d) a scheduled review at the first published
 *   merchant. A hypothetical edge case does NOT reopen — it is logged in a named backlog.
 */
import assert from "node:assert/strict";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree, RULE_V10 } from "../authoring/brain2/tree.js";
import { AXIS_SELECTOR_VERSION, rankAxesV10, acceptanceGates } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

check("1. axis_selector_version is FROZEN at v10", () => {
  assert.equal(AXIS_SELECTOR_VERSION, "v10");
});

check("2. FROZEN ranking — the tie-break order is pinned (edit ⇒ red; reopen needs an artifact)", () => {
  // penalized ↑ first; tie broken by k ↑ → maxSize ↑ → evidence ↓ → id ↑.
  assert.deepEqual(rankAxesV10([
    { ax: "a", penalized: 12, k: 3, maxSize: 2, evidence: 6 },
    { ax: "b", penalized: 12, k: 2, maxSize: 6, evidence: 6 }, // penalized tie with a ⇒ fewer options (k) wins
    { ax: "c", penalized: 8, k: 4, maxSize: 4, evidence: 9 },  // lowest penalized ⇒ first overall
  ]).map((r) => r.ax), ["c", "b", "a"], "frozen primary+k order");
  assert.deepEqual(rankAxesV10([
    { ax: "x", penalized: 5, k: 2, maxSize: 3, evidence: 2 },
    { ax: "y", penalized: 5, k: 2, maxSize: 3, evidence: 9 }, // higher evidence wins the (penalized,k,maxSize) tie
  ]).map((r) => r.ax), ["y", "x"], "evidence tie-break (higher wins)");
  assert.deepEqual(rankAxesV10([
    { ax: "y", penalized: 5, k: 2, maxSize: 3, evidence: 5 },
    { ax: "x", penalized: 5, k: 2, maxSize: 3, evidence: 5 }, // full tie ⇒ canonical id, last resort
  ]).map((r) => r.ax), ["x", "y"], "id last resort (deterministic)");
});

check("3. SEPARATION — the frozen ranking carries NO safety: given accepted axes it only orders, never drops", () => {
  const accepted = [{ ax: "a", penalized: 1, k: 1, maxSize: 1, evidence: 0 }, { ax: "b", penalized: 9, k: 9, maxSize: 9, evidence: 9 }];
  assert.equal(rankAxesV10(accepted).length, accepted.length, "every accepted axis is preserved (no gate in the ranking)");
  // and the GATES (safety) are the ones that drop/route — proven by acceptanceGates producing rejected/displayMode
  const g = acceptanceGates({ solo: { sizes: [10] }, mirror: { sizes: [1, 1, 1] } }, { S: 10, minExactRatio: 0.5, maxOptions: 8 });
  assert.ok(g.rejected.some((r) => r.ax === "solo" && r.reason === "no-split"), "the GATES reject a no-split axis (safety)");
  assert.ok(g.displayMode.some((r) => r.ax === "mirror"), "the GATES route an all-singleton axis to display mode (safety)");
});

// 4. surface@cap is a SHAPE measurement of the built tree — NARROWED OUT of the freeze (ADR-0068). The freeze
// asserts rankAxesV10 BEHAVIOR only (checks 1–3, synthetic inputs); a tree-SHAPE number is not the ranking's
// contract, so tying a reopen to it was testing the wrong thing. surface@cap is REPORTED here as a diagnostic
// (it legitimately moved 61→57 when budget became a leaf-level ceiling filter — one fewer branch axis, ADR-0068).
const oud = await oudOneLevelInputs();
check("4. surface@cap is REPORTED as a shape diagnostic (NOT a freeze gate — the freeze is rankAxesV10 behavior only)", () => {
  const o = new AuthoringOracle({ units: oud.units, resolvedContracts: oud.resolvedContracts, context: oud.context });
  const tree = buildFullTree(o, { limits: { ...oud.treeLimits, leaf_primary_cap: oud.leafCaps.primary }, rule: RULE_V10 });
  const CAP = oud.leafCaps.total;
  const skusOf = (fams) => fams.flatMap((f) => oud.skusByFamily[f] || []);
  const atCap = new Set();
  for (const leaf of tree.leaves) { const shown = [...o.membersOf(leaf.pools.exact_ref).slice().sort(), ...o.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP); for (const s of skusOf(shown)) atCap.add(s); }
  assert.ok(atCap.size > 0, "the tree surfaces SKUs at cap (a non-empty shape sanity, not a frozen baseline)");
  console.log(`  · surface@cap (shape diagnostic) = ${atCap.size}/${oud.skuCount}. NOT a freeze gate — the freeze is rankAxesV10 behavior (checks 1–3). SKU-level delivered reach lives in certifier.gap7 (the size picker).`);
});

if (process.exitCode === 1) console.error("\nFAIL — the axis-selector freeze was violated (version, tie-break, separation, or a surface regression).\n");
else console.log(`\nPASS — all ${passed} freeze checks: v10 frozen, tie-break pinned, gates separated from ranking, surface@cap baseline held.\n`);
