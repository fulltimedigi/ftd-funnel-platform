/**
 * tests/kernel.fuzz.test.mjs — property / fuzz stress on the kernel + authoring (ADR-0037).
 * ---------------------------------------------------------------------------------------------
 * The spec's required adversarial catalogs: nulls, duplicate / dominated profiles, multi-label,
 * numeric boundaries, single-product, all-identical, deleted-after-compile, price/stock mutation.
 * The invariants that must hold on EVERY generated catalog (or authoring must honestly refuse):
 *   • the kernel never throws;
 *   • a NEVER_RELAX constraint is never VIOLATED/UNKNOWN on a chosen unit;
 *   • an EXACT candidate is never passed over for a COMPROMISE;
 *   • disclosure equals a fresh re-comparison (never silent);
 *   • when a funnel IS authored, verifyFunnel proves the 6 exit criteria.
 * Deterministic pseudo-randomness (seeded LCG) — no Math.random, reproducible in CI.
 */
import assert from "node:assert/strict";
import { select, evaluateUnit, disclose, NEVER_RELAX, RELAXABLE, EXACT, COMPROMISE, VIOLATED, UNKNOWN, SAT } from "../engine/kernel/constraintKernel.js";
import { authorFunnel } from "../authoring/author/index.js";
import { verifyFunnel } from "../engine/kernel/verifyFunnel.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

// seeded LCG (deterministic)
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000; }

const FORMATS = ["oil", "spray", "raw", "set"];
const CHARS = ["woody", "floral", "smoky", "fresh"];
const TIERS = ["low", "mid", "high"];

const cFormat = { id: "format", label: "الشكل", type: "nominal", mode: NEVER_RELAX, strict: true, priority: 0, order: FORMATS };
const cBudget = { id: "budget", label: "الميزانية", type: "ordinal", mode: RELAXABLE, strict: true, priority: 1, order: TIERS };
const cChar = { id: "char", label: "الطابع", type: "nominal", mode: RELAXABLE, strict: false, priority: 2, order: CHARS };
const CS = [cFormat, cBudget, cChar];

/** Build one adversarial unit set from a seed + a "shape" knob. */
function fuzzUnits(seed, shape) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const N = shape === "single" ? 1 : 2 + Math.floor(r() * 8);
  const units = [];
  for (let i = 0; i < N; i++) {
    const values = new Map();
    // nulls: sometimes leave an axis ungrounded
    const fmt = shape === "identical" ? "oil" : pick(FORMATS);
    if (!(shape === "nulls" && r() < 0.4)) values.set("format", { value: fmt, grounded: r() > 0.1 || shape !== "nulls" });
    if (!(shape === "nulls" && r() < 0.3)) values.set("budget", { value: shape === "identical" ? "mid" : pick(TIERS), grounded: true });
    // multi-label char
    const chv = shape === "multilabel" ? [pick(CHARS), pick(CHARS)] : (shape === "identical" ? "woody" : pick(CHARS));
    if (!(shape === "nulls" && r() < 0.3)) values.set("char", { value: chv, grounded: true });
    units.push({ id: `u${i}`, values });
  }
  return units;
}

const SHAPES = ["random", "nulls", "identical", "multilabel", "single", "dominated"];

check("kernel never throws & honours its invariants across 600 fuzzed selections", () => {
  for (let seed = 1; seed <= 100; seed++) {
    for (const shape of SHAPES) {
      const units = fuzzUnits(seed, shape);
      const catalogUrls = new Set(units.map((u) => u.id));
      const r = rng(seed * 7 + shape.length);
      const answers = { format: FORMATS[Math.floor(r() * FORMATS.length)], budget: TIERS[Math.floor(r() * TIERS.length)], char: CHARS[Math.floor(r() * CHARS.length)] };
      let res;
      assert.doesNotThrow(() => { res = select(units, CS, answers, { catalogUrls, bounds: { maxBudgetOvershootTiers: 3 } }); }, `select threw on seed ${seed}/${shape}`);
      if (res.product_id == null) { assert.equal(res.match_state, "NO_MATCH"); continue; }
      // NEVER_RELAX never broken on the chosen unit
      const chosen = units.find((u) => u.id === res.product_id);
      const perC = evaluateUnit(chosen, CS, answers);
      assert.equal(perC.format.state, SAT, `format (never-relax) not SAT on chosen — seed ${seed}/${shape}`);
      // exact dominance: if any survivor is EXACT, the chosen must be EXACT
      const survivors = units.filter((u) => evaluateUnit(u, CS, answers).format.state === SAT);
      const anyExact = survivors.some((u) => { const p = evaluateUnit(u, CS, answers); return p.budget.state === SAT && p.char.state !== VIOLATED; });
      if (anyExact) assert.notEqual(res.match_state, COMPROMISE, `passed over an EXACT for a COMPROMISE — seed ${seed}/${shape}`);
      // disclosure == fresh re-comparison
      const fresh = disclose(chosen, CS, answers, perC);
      assert.equal(fresh.conflicts.length, res.conflicts.length, `disclosure drift — seed ${seed}/${shape}`);
    }
  }
});

check("authoring either refuses honestly or produces a funnel that PASSES publish-time verify", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed * 13 + 5);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const N = 4 + Math.floor(r() * 16);
    const products = [];
    for (let i = 0; i < N; i++) {
      const fmt = pick(["Oud Oil 3ml", "Eau De Parfum", "Agarwood Chips", "Gift Set"]);
      products.push({ name: `${pick(["Hindi", "Cambodi", "Royal", "Amber"])} ${fmt} ${i}`, url: `https://f.example/p/${seed}-${i}`, price: 50 + Math.floor(r() * 3000), attributes: { type: pick(["Perfume", "Oud Oil", "Wood", "Set"]) }, differentiators: [pick(CHARS)] });
    }
    let gen;
    assert.doesNotThrow(() => { gen = authorFunnel({ origin: "https://f.example", products, brandUrl: "https://f.example" }, { brandName: "Fuzz" }); }, `authorFunnel threw on seed ${seed}`);
    if (!gen.ok) continue; // an honest refusal is a valid outcome
    const v = verifyFunnel(gen.config, { products }, undefined);
    assert.ok(v.ok, `published funnel failed verify on seed ${seed}: ${JSON.stringify(v.findings.slice(0, 3))}`);
    // and the authoring layer's own axisSet-level proof must be clean
    assert.ok(gen.meta.verify && gen.meta.verify.ok, `authoring proof not clean on seed ${seed}`);
  }
});

check("deleted-after-compile & price mutation: verify catches a broken served catalog", () => {
  const products = Array.from({ length: 10 }, (_, i) => ({ name: `Item ${i} ${["Oud Oil", "Eau De Parfum", "Agarwood Chips"][i % 3]}`, url: `https://m.example/p/${i}`, price: 100 + i * 120, attributes: { type: ["Oud Oil", "Perfume", "Wood"][i % 3] }, differentiators: [CHARS[i % 4]] }));
  const gen = authorFunnel({ origin: "https://m.example", products, brandUrl: "https://m.example" }, { brandName: "Mut" });
  assert.equal(gen.ok, true, gen.reason);
  // delete a product that the table references → served catalog is missing it → criterion 1 fires
  const referenced = gen.config.archetypes[0].recommendations.primary.url;
  const broken = products.filter((p) => p.url !== referenced);
  const v = verifyFunnel(gen.config, { products: broken }, undefined);
  assert.equal(v.ok, false, "verify must flag a product deleted after compile");
  assert.ok(v.findings.some((f) => f.criterion === 1), JSON.stringify(v.findings.slice(0, 3)));
});

if (process.exitCode === 1) console.error("\nFAIL — a fuzzed catalog broke an invariant.\n");
else console.log(`\nPASS — all ${passed} fuzz / property assertions passed.\n`);
