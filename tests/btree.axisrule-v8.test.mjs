/**
 * tests/btree.axisrule-v8.test.mjs — AXIS-RULE v8 (consultation round-8). Mirror is BEHAVIORAL; the
 * counts-only brain keeps the two error-free counting bounds and the corrected signal, and defers the
 * semantic judgment to the authoring gates. Changes vs v7:
 *   • OPTIONS CAP (the bound v7 lacked): reject an axis whose published option count exceeds one display's
 *     capacity (policy.max_published_options_per_question) — THIS catches the wide-catalog mirror the
 *     decisive bound lets through. Routed to a ق20 display mode, not a branch.
 *   • MIRROR SHARE corrected: counted over VALUE-CONFIRMING options only — a big "don't care" bucket cannot
 *     mask a mirror in the remaining options. Ranking keeps every bucket (incl. don't-care and u₀).
 *   • Decisive bound kept (no option ≥2 ⇒ reject): zero false positives, but its LARGE false negative on wide
 *     catalogs is demonstrated here and shown to be caught by the options cap instead.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree, RULE_V7, RULE_V8 } from "../authoring/brain2/tree.js";
import { diagnoseAxesV8 } from "../authoring/brain2/axisRule.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const pol = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "config", "policy.json"), "utf8"));
const MINR = pol.authoring_tree.min_exact_option_ratio, MAXOPT = pol.authoring_tree.max_published_options_per_question;
const dg = (stat, S, maxOptions = MAXOPT) => diagnoseAxesV8({ x: stat }, { S, minExactRatio: MINR, maxOptions });

// ── decisive bound kept ─────────────────────────────────────────────────────────────────────────────────
check("decisive bound kept: all-singleton ⇒ reject · [10,1,1] ⇒ accept · all-size-2 ⇒ accept", () => {
  assert.equal(dg({ sizes: [1, 1, 1] }, 3).chosen, null);
  assert.equal(dg({ sizes: [10, 1, 1] }, 12).chosen, "x");
  assert.equal(dg({ sizes: [2, 2, 2, 2] }, 8).chosen, "x", "4 size-2 options (≤ options cap) ⇒ accepted");
});

// ── the decisive bound's KNOWN false negative, and the OPTIONS CAP that catches it ──────────────────────
check("decisive bound's LARGE false negative (one size-2 option + 498 singletons) — and the options cap catches it", () => {
  const wide = { sizes: [2, ...Array(498).fill(1)] }; const S = 500;
  assert.equal(dg(wide, S, null).chosen, "x", "WITHOUT the cap the decisive bound MISSES it (max sᵢ=2≥2) — 499 options, a disguised grid slips through");
  const d = dg(wide, S, MAXOPT);
  assert.equal(d.chosen, null, "WITH the options cap it is rejected");
  assert.ok(d.rejected.some((r) => r.ax === "x" && r.reason.startsWith("options-cap")), "rejected by the options cap (routed to a ق20 display mode): " + JSON.stringify(d.rejected));
});
check("options cap is inert on a normal question ([4,4,4], 3 options ≤ cap)", () => {
  assert.equal(dg({ sizes: [4, 4, 4] }, 12).chosen, "x");
});

// ── corrected mirror share: a big "don't care" bucket must NOT mask a mirror ─────────────────────────────
check("mirror share is measured over VALUE-CONFIRMING options only — a big don't-care bucket cannot dilute it", () => {
  // option 0 = "don't care" (confirms=false, size 10); options 1..3 confirm a value and are all singletons.
  const stat = { sizes: [10, 1, 1, 1], confirms: [false, true, true, true] };
  const d = diagnoseAxesV8({ x: stat }, { S: 13, minExactRatio: MINR, maxOptions: MAXOPT });
  const sig = d.signals.find((s) => s.ax === "x");
  assert.equal(sig.mirror_singleton_share, 1, "3 confirming singletons / Σ confirming(3) = 1.0 — the signal RISES, not masked");
  const dilutedIfWrong = 3 / 13; // what /all-options would have (wrongly) reported
  assert.ok(sig.mirror_singleton_share > dilutedIfWrong, "the confirming-only denominator prevents the mask");
});
check("ranking keeps the don't-care bucket AND u₀ as real residual buckets (mirror excludes them, ranking does not)", () => {
  const d = diagnoseAxesV8({ x: { sizes: [10, 1, 1, 1], confirms: [false, true, true, true] } }, { S: 20, minExactRatio: MINR, maxOptions: MAXOPT });
  const r = d.ranked.find((x) => x.ax === "x");
  assert.equal(r.penalized, 100 + 1 + 1 + 1 + (20 - 13) * (20 - 13), "penalized = Σsᵢ²(103) + u₀²(49) — every bucket counts in the ranking");
});

// ── oud before/after v7 → v8 ────────────────────────────────────────────────────────────────────────────
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
check("OUD before/after v7 → v8: identical structure (options cap inert at 5<8); v8 adds the published-options report", () => {
  const b = measure(RULE_V7), a = measure(RULE_V8);
  console.log(`  · v7: surface@cap=${b.atCap}/80 depth=${b.depth} rejections=${b.rej.length}`);
  console.log(`  · v8: surface@cap=${a.atCap}/80 depth=${a.depth} rejections=${a.rej.length} (all decisive all-singleton; options-cap inert) · options/axis reported: ${[...new Set(a.sig.map((s) => s.published_options))].join(",")}`);
  assert.equal(a.atCap, b.atCap, "same surface (v8 = v7 on oud; the new bounds are inert here)");
  assert.equal(a.reach.ok, true);
  assert.ok(a.rej.every((r) => r.reason.startsWith("mirror:all-singleton")), "no options-cap rejection on oud (max 5 opts/axis)");
  assert.ok(a.sig.every((s) => Number.isInteger(s.published_options)), "published_options reported per chosen axis");
});

if (process.exitCode === 1) console.error("\nFAIL — axis-rule v8 did not behave as specified.\n");
else console.log(`\nPASS — all ${passed} axis-rule v8 checks passed (options cap catches wide mirrors; confirming-only share; ranking keeps all buckets).\n`);
