/**
 * tests/btree.axisrule-v7.test.mjs — AXIS-RULE v7 (consultation round-7). Mirror is a SEMANTIC property the
 * counts-only brain cannot judge, so v7 keeps only the ONE infallible counts bound and demotes the rest to a
 * reported signal:
 *   • DECISIVE mirror GUARD: reject an axis for branching ONLY when NO published option isolates >1 item
 *     (max sᵢ < 2 — a disguised grid). No threshold, no small-pool exemption.
 *   • MINORITY mirror = a REPORTED signal, not a gate: mirror_singleton_share = (#singleton options)/Σsᵢ,
 *     measured on the GROUNDED pool only (an unknown is not a revealing option). Escalated to authoring gates.
 *   • Two denominators kept distinct: RANKING (Σsᵢ²+u₀²)/S (unknown is a real bucket) vs MIRROR /Σsᵢ.
 * Red-first: the four decisive tests, the v6→v7 fix of the sparse-axis false-positive, the grounded mirror
 * denominator, minority-mirror-as-signal, and the oud before/after.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree, RULE_V6, RULE_V7 } from "../authoring/brain2/tree.js";
import { diagnoseAxesV6, diagnoseAxesV7 } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const pol = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "config", "policy.json"), "utf8"));
const MINR = pol.authoring_tree.min_exact_option_ratio, TOTAL = pol.surface.leaf_total_cap;
const one = (sizes, S) => ({ x: { sizes, evidence: S } });
const acceptV7 = (sizes, S) => diagnoseAxesV7(one(sizes, S), { S, minExactRatio: MINR }).chosen !== null;

// ── DECISIVE mirror bound (the four operator tests; no free number, no exemption) ───────────────────────
check("all options singleton ⇒ REJECT (a disguised grid — showing the grid is more honest)", () => {
  assert.equal(acceptV7([1, 1, 1, 1], 4), false);
  const d = diagnoseAxesV7(one([1, 1, 1, 1], 4), { S: 4, minExactRatio: MINR });
  assert.ok(d.rejected.some((r) => r.reason.startsWith("mirror:all-singleton")), "rejected as decisive mirror: " + JSON.stringify(d.rejected));
});
check("S=2 two singletons ⇒ REJECT (no exemption — a grid is truer than a one-shot mirror question)", () => {
  assert.equal(acceptV7([1, 1], 2), false);
});
check("a big bucket + singletons [10,1,1] ⇒ ACCEPT (one option isolates >1)", () => {
  assert.equal(acceptV7([10, 1, 1], 12), true);
});
check("all buckets size 2 ⇒ ACCEPT (each answer leaves two — not a DECISIVE mirror)", () => {
  assert.equal(acceptV7(Array(10).fill(2), 20), true);
});

// ── the v6→v7 fix: the sparse-axis /S false-positive is gone ────────────────────────────────────────────
check("v6→v7 FIX: a sparse soft axis [6,6] at S=20 (u₀=8) — v6 mirror-rejected it, v7 ACCEPTS (max sᵢ=6≥2)", () => {
  assert.equal(diagnoseAxesV6(one([6, 6], 20), { S: 20, minExactRatio: MINR, leafTotalCap: TOTAL }).chosen, null, "v6 wrongly rejects (Σsᵢ²/S=3.6<4)");
  assert.equal(diagnoseAxesV7(one([6, 6], 20), { S: 20, minExactRatio: MINR }).chosen, "x", "v7 accepts — the options don't isolate individuals");
});

// ── MIRROR measured on the GROUNDED pool, and REPORTED not gated ────────────────────────────────────────
check("mirror_singleton_share uses the GROUNDED denominator (/Σsᵢ), not /S", () => {
  const d = diagnoseAxesV7(one([5, 1], 10), { S: 10, minExactRatio: MINR }); // Σsᵢ=6, u₀=4; one singleton
  const sig = d.signals.find((s) => s.ax === "x");
  assert.equal(sig.mirror_singleton_share, Number((1 / 6).toFixed(3)), "share = 1 singleton / Σsᵢ(6) = 0.167, NOT 1/10");
  assert.equal(d.chosen, "x", "and it is NOT gated — a minority mirror is only reported");
});
check("minority mirror is a SIGNAL not a gate: [10,1,1] is accepted, share reported", () => {
  const d = diagnoseAxesV7(one([10, 1, 1], 12), { S: 12, minExactRatio: MINR });
  assert.equal(d.chosen, "x");
  assert.equal(d.signals.find((s) => s.ax === "x").mirror_singleton_share, Number((2 / 12).toFixed(3)), "2 singleton options / Σsᵢ(12)");
});

// ── RANKING still (Σsᵢ²+u₀²)/S: the unknown IS a real residual bucket ────────────────────────────────────
check("RANKING keeps u₀ as a real bucket: penalized == Σsᵢ² + u₀² (unknown weighted in the ranking, not the mirror)", () => {
  const d = diagnoseAxesV7({ full: { sizes: [4, 4, 4], evidence: 12 }, sparse: { sizes: [6, 6], evidence: 12 } }, { S: 12, minExactRatio: MINR });
  const pen = Object.fromEntries(d.ranked.map((r) => [r.ax, r.penalized]));
  assert.equal(pen.full, 48, "[4,4,4] u₀=0 → 48");
  assert.equal(pen.sparse, 72 + 0, "[6,6] u₀=0 → 72"); // both u₀=0 here; ranking uses Σsᵢ²+u₀²
  assert.equal(d.chosen, "full", "min penalized wins");
});

// ── oud before/after v6 → v7 ────────────────────────────────────────────────────────────────────────────
const inputs = await oudOneLevelInputs();
const CAP = inputs.leafCaps.total;
const fresh = () => new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const limits = { ...inputs.treeLimits, leaf_primary_cap: inputs.leafCaps.primary };
function measure(rule) {
  const o = fresh(); const tree = buildFullTree(o, { limits, rule });
  const skusOf = (fams) => fams.flatMap((f) => inputs.skusByFamily[f] || []);
  const cand = new Set(), atCap = new Set();
  for (const leaf of tree.leaves) { for (const s of skusOf(o.membersOf(leaf.pools.eligible_ref))) cand.add(s); const shown = [...o.membersOf(leaf.pools.exact_ref).slice().sort(), ...o.membersOf(leaf.pools.compromise_ref).slice().sort()].slice(0, CAP); for (const s of skusOf(shown)) atCap.add(s); }
  return { rule: tree.ruleId, atCap: atCap.size, cand: cand.size, depth: tree.depth, reach: o.verifyReachability(tree.nodes), rej: tree.guardRejections || [], sig: tree.mirrorSignals || [] };
}
check("OUD before/after v6 → v7: the origin /S flood is gone, surface recovers, signals reported, ledger clean", () => {
  const b = measure(RULE_V6), a = measure(RULE_V7);
  console.log(`  · v6: surface@cap=${b.atCap}/80 depth=${b.depth} mirror-rejections=${b.rej.length} (all ${[...new Set(b.rej.map((r) => r.axis))].join(",")})`);
  console.log(`  · v7: surface@cap=${a.atCap}/80 depth=${a.depth} decisive-mirror-rejections=${a.rej.length} · signals=${a.sig.map((s) => `${s.axis}@S${s.S}=${s.mirror_singleton_share}`).join(", ")}`);
  console.log(`  · v7 reach ledger: ok=${a.reach.ok} exact_drops=${a.reach.exact_drops} unrecorded=${a.reach.unrecorded_eligible_drops}`);
  assert.ok(a.rej.length < b.rej.length, "v7 makes FEWER mirror rejections than v6 (the sparse-axis false-positives are gone)");
  assert.ok(a.rej.every((r) => r.reason.startsWith("mirror:all-singleton")), "every v7 rejection is a DECISIVE (all-singleton) mirror, not a sparsity artifact");
  assert.equal(a.atCap, 61, "surface@cap recovers to 61 (v6 had suppressed origin to 55)");
  assert.equal(a.reach.ok, true, "reach ledger clean");
  assert.equal(a.cand, 80, "reach 80/80 unchanged");
});

if (process.exitCode === 1) console.error("\nFAIL — axis-rule v7 did not behave as specified.\n");
else console.log(`\nPASS — all ${passed} axis-rule v7 checks passed (decisive mirror bound + reported minority signal; two denominators distinct).\n`);
