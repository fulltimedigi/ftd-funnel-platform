/**
 * tests/predicate-truthtable.test.mjs — the shared TCB (predicate truth tables) + metamorphic
 * properties (ADR-0037 closing, item 4). `status` is the ONE definition both the kernel and the
 * independent oracle trust; it must be exhaustively pinned. The metamorphic properties pin the
 * selection's invariants without re-encoding its algorithm.
 */
import assert from "node:assert/strict";
import { status, select, SAT, VIOLATED, UNKNOWN, NEVER_RELAX, RELAXABLE, EXACT, COMPROMISE } from "../engine/kernel/constraintKernel.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const g = (v) => ({ value: v, grounded: true });
const st = (c, a, uv) => status(c, a, uv).state;

check("TRUTH TABLE — nominal (set membership)", () => {
  const c = { id: "n", type: "nominal", order: ["a", "b", "c"] };
  assert.equal(st(c, "a", g("a")), SAT);
  assert.equal(st(c, "a", g(["a", "b"])), SAT);
  assert.equal(st(c, "a", g("b")), VIOLATED);
  assert.equal(st(c, ["a", "c"], g("c")), SAT);
  assert.equal(st(c, "a", { value: null, grounded: false }), UNKNOWN);
  assert.equal(st(c, "a", { value: "a", grounded: false }), UNKNOWN);
  assert.equal(status(c, null, g("a")).state, SAT); // not asked → vacuous
});

check("TRUTH TABLE — taxonomy (ancestor-or-equal)", () => {
  const c = { id: "t", type: "taxonomy", descendants: { spray: ["edp", "edt"] } };
  assert.equal(st(c, "spray", g("edp")), SAT);
  assert.equal(st(c, "spray", g("edt")), SAT);
  assert.equal(st(c, "spray", g("spray")), SAT);
  assert.equal(st(c, "spray", g("oil")), VIOLATED);
});

check("TRUTH TABLE — ordinal (distance magnitude)", () => {
  const c = { id: "o", type: "ordinal", order: ["low", "mid", "high"] };
  assert.equal(status(c, "mid", g("mid")).state, SAT);
  assert.equal(status(c, "low", g("mid")).magnitude, 1);
  assert.equal(status(c, "low", g("high")).magnitude, 2);
  assert.equal(status(c, "mid", g("zzz")).state, UNKNOWN); // value not on the scale
});

check("TRUTH TABLE — price (directional, boundary-exact)", () => {
  const c = { id: "p", type: "price" };
  assert.equal(status(c, { cap: 500 }, g(499)).state, SAT);
  assert.equal(status(c, { cap: 500 }, g(500)).state, SAT); // boundary inclusive
  assert.equal(status(c, { cap: 500 }, g(501)).state, VIOLATED);
  assert.equal(status(c, { cap: 500 }, g(900)).magnitude, 400);
  assert.equal(status(c, { min: 100 }, g(50)).magnitude, 50);
  assert.equal(status(c, { cap: 500 }, { value: "n/a", grounded: true }).state, UNKNOWN);
});

// ---- metamorphic properties of selection ------------------------------------------------------
const cF = { id: "format", type: "nominal", mode: NEVER_RELAX, strict: true, priority: 0, order: ["oil", "spray"] };
const cB = { id: "budget", type: "ordinal", mode: RELAXABLE, strict: true, priority: 1, order: ["low", "mid", "high"] };
const CS = [cF, cB];
const mk = (id, f, b) => ({ id, values: new Map([["format", g(f)], ["budget", g(b)]]) });
const pick = (units, ans) => select(units, CS, ans, { catalogUrls: new Set(units.map((u) => u.id)), bounds: { maxBudgetOvershootTiers: 3 } });

check("METAMORPHIC — reordering the catalog does not change the winner", () => {
  const a = mk("a", "oil", "mid"), b = mk("b", "oil", "high"), c = mk("c", "oil", "low");
  const ans = { format: "oil", budget: "mid" };
  const w1 = pick([a, b, c], ans).product_id;
  const w2 = pick([c, b, a], ans).product_id;
  const w3 = pick([b, a, c], ans).product_id;
  assert.equal(w1, w2); assert.equal(w2, w3);
  assert.equal(w1, "a", "the exact-tier product wins regardless of order");
});

check("METAMORPHIC — adding an EXACT candidate drops a COMPROMISE result to EXACT", () => {
  const ans = { format: "oil", budget: "mid" };
  const before = pick([mk("hi", "oil", "high")], ans); // only an off-tier option
  assert.equal(before.match_state, COMPROMISE);
  const after = pick([mk("hi", "oil", "high"), mk("ex", "oil", "mid")], ans);
  assert.equal(after.match_state, EXACT);
  assert.equal(after.product_id, "ex");
});

check("METAMORPHIC — raising an ordinal past the shopper's tier flips SAT→VIOLATED", () => {
  const near = status(cB, "low", g("low"));
  assert.equal(near.state, SAT);
  const far = status(cB, "low", g("mid"));
  assert.equal(far.state, VIOLATED);
  assert.ok(far.magnitude > 0);
});

if (process.exitCode === 1) console.error("\nFAIL — a predicate/metamorphic property broke.\n");
else console.log(`\nPASS — all ${passed} truth-table + metamorphic assertions passed.\n`);
