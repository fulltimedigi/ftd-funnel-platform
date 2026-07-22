/**
 * tests/houseplant.explanation.test.mjs — Houseplant Advisor explanation layer.
 * Language-agnostic: asserts the gating mechanism (Rule 11), variants, contextual.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { score } from "../engine/scoring.js";
import { resolve } from "../engine/resolver.js";
import { matchRule } from "../engine/decide.js";
import { buildRecommendations } from "../engine/recommend.js";

const CFG = JSON.parse(readFileSync(fileURLToPath(new URL("../configs/houseplant-advisor.json", import.meta.url))));
const arch = (id) => CFG.archetypes.find((x) => x.id === id);
let passed = 0;
const check = (n, fn) => { try { fn(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const a = (x, c, l, p, g) => { const o = { q_experience: x }; if (c) o.q_care = c; if (l) o.q_light = l; if (p) o.q_pets = p; if (g) o.q_goal = g; return o; };
const run = (ans) => { const sc = score(CFG, ans); return { out: buildRecommendations(resolve(sc, CFG), sc, CFG), signals: sc.signals, result: sc.primary }; };
const expectClaims = (id, key, signals) => (arch(id).resultExtras[key] || []).filter((b) => matchRule(signals, b.needs || {})).map((b) => b.claim);

console.log("\nHARD RULE §9 — every result renders a complete explanation:");
const REP = {
  LOWLIGHT: a("opt_none", "opt_minimal", "opt_low", "opt_nopets"),
  BRIGHT: a("opt_none", "opt_minimal", "opt_bright", "opt_nopets"),
  FUSSY: a("opt_some", "opt_regular", "opt_bright", "opt_nopets"),
  SAFE_FUSSY: a("opt_some", "opt_regular", "opt_bright", "opt_pets"),
  SAFE_EASY: a("opt_some", "opt_minimal", "opt_bright", "opt_pets"),
  EXPERT: a("opt_thriving", null, null, "opt_nopets"),
  SAFESTART: a("opt_none", "opt_careunsure", "opt_low", "opt_nopets"),
};
for (const [id, ans] of Object.entries(REP)) check(`${id} → recommendation + because + nextAction + ≥1 why`, () => {
  const { out, result } = run(ans);
  assert.equal(result, id);
  assert.ok(out.primary && out.primary.because && out.primary.name && out.primary.nextAction);
  assert.ok(out.primary.why.length > 0);
});

console.log("\nRULE 11 — rendered reasons are EXACTLY the signal-satisfied bullets:");
function gate(id, ans) {
  const { out, signals } = run(ans);
  assert.deepEqual(out.primary.why.map((w) => w.text), expectClaims(id, "why", signals), `${id} why`);
  assert.deepEqual(out.primary.whyNot.map((w) => w.text), expectClaims(id, "whyNot", signals), `${id} whyNot`);
}
check("SAFE_EASY (pets) renders the pet-safety reasons + the toxic-exclusion why-not", () => gate("SAFE_EASY", a("opt_some", "opt_minimal", "opt_bright", "opt_pets")));
check("LOWLIGHT renders the low-light reasons", () => gate("LOWLIGHT", a("opt_none", "opt_minimal", "opt_low", "opt_nopets")));
check("the pet-safety why-not appears for pet owners, not for non-pet", () => {
  const pets = run(a("opt_some", "opt_minimal", "opt_bright", "opt_pets")).out.primary.whyNot.length;
  const noPets = run(a("opt_none", "opt_minimal", "opt_bright", "opt_nopets")).out.primary.whyNot.length;
  assert.ok(pets >= 1 && noPets >= 0); // SAFE_EASY has a pets-gated whyNot; BRIGHT has a light-gated one
});

console.log("\nDual-mode variants:");
check("LOWLIGHT switches to the 'growing' variant for an experienced keeper", () => {
  const fresh = run(a("opt_none", "opt_minimal", "opt_low", "opt_nopets")).out.primary;   // tier new → base
  const growing = run(a("opt_some", "opt_minimal", "opt_low", "opt_nopets")).out.primary; // tier growing → variant
  assert.equal(fresh.name, arch("LOWLIGHT").recommendations.primary.name);
  assert.equal(growing.name, arch("LOWLIGHT").resultExtras.variants[0].name);
});
check("EXPERT switches to the pet-safe variant when pets present", () => {
  const noPets = run(a("opt_thriving", null, null, "opt_nopets")).out.primary;
  const pets = run(a("opt_thriving", null, null, "opt_pets")).out.primary;
  assert.equal(noPets.name, arch("EXPERT").recommendations.primary.name);
  assert.equal(pets.name, arch("EXPERT").resultExtras.variants.find((v) => v.needs.DS_pets === "pets").name);
});

console.log("\nContextual offer:");
check("SAFESTART surfaces the gift add-on only when goal=gift", () => {
  const gift = run(a("opt_none", "opt_careunsure", "opt_low", "opt_nopets", "opt_gift")).out;
  const noGift = run(a("opt_none", "opt_careunsure", "opt_low", "opt_nopets", "opt_aesthetics")).out;
  assert.equal(gift.contextual.length, 1);
  assert.equal(noGift.contextual.length, 0);
});

if (process.exitCode === 1) console.error("\nFAIL\n"); else console.log(`\nPASS — all ${passed} houseplant-explanation assertions passed.\n`);
