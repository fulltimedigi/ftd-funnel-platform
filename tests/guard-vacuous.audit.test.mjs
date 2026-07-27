/**
 * tests/guard-vacuous.audit.test.mjs — STEP 1-B: vacuous-truth audit of the certificate-layer guards.
 * A negative fixture per guard that carried a real empty-set / zero-denominator risk, proving it was
 * examined and pinning its behaviour (closed, or safe-only-by-caller-ordering + recorded).
 */
import assert from "node:assert/strict";
import { verifyFunnel } from "../engine/kernel/verifyFunnel.js";
import { verifyServedResult } from "../engine/kernel/verifyRuntime.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const V = { catalog_version: "c1", policy_version: "p1", answer_contract_version: "a1", config_hash: "h1", locale_bundle_version: "l1" };
const PROVEN = "https://shop.example/products/x";

// ── #7 proof-coverage ZERO DENOMINATOR — CLOSED. A terminals-only decision funnel (renderable=0) used
//    to yield a vacuous proofCoverage=1 and no finding. Now it FAILS explicitly. ──
check("#7 zero-denominator: a decision funnel with ZERO COMMERCE slots FAILS (no vacuous 100%)", () => {
  const cfg = {
    id: "t", scoring: { mode: "decision-table" }, resultLayout: "commerce", ...V,
    constraintPolicy: [], archetypes: [],
    decisionTable: [
      { id: "r_0", kind: "TERMINAL", when: { D_x: "a" }, terminal_state: "NO_MATCH", terminal_proof: { product_id: null } },
      { id: "r_default", kind: "TERMINAL", when: {}, terminal_state: "RESTART_REQUIRED" },
    ],
  };
  const r = verifyFunnel(cfg, { products: [] });
  assert.equal(r.proofCoverage, 0, "zero renderable ⇒ coverage 0, never a vacuous 1");
  assert.equal(r.ok, false, "a funnel that recommends no product on any path is not publishable");
  assert.ok(r.report.failures.some((f) => /no renderable COMMERCE slot/.test(f.msg)), "explicit finding, not silence");
});

// ── #6 verifyServedResult — SAFE ONLY BY CALLER ORDERING (recorded fragility). On a proofless rule the
//    never-relax loops iterate over []=[] and pass vacuously; only certifyForRender's proof-existence
//    guard (called BEFORE verifyServedResult) prevents this from ever being reached live. Pin it. ──
check("#6 verifyServedResult passes vacuously on a proofless rule — safe ONLY because certifyForRender guards proof first", () => {
  const cfg = { ...V, constraintPolicy: [], decisionTable: [{ id: "r_0", kind: "COMMERCE", when: { D_x: "a" }, result: "R1" /* NO proof */ }] };
  const resolved = { scoring: { ruleId: "r_0" }, primary: { recommendations: { primary: { url: PROVEN } } } };
  const vr = verifyServedResult(cfg, resolved, V);
  assert.equal(vr.ok, true, "PINNED: verifyServedResult ALONE is vacuously ok on a proofless rule (documented fragility)");
  // The REAL protection is upstream: certifyForRender refuses a proofless rule BEFORE calling this
  // (certifyForRender.js:101 before :105). This test exists so a refactor that reorders them reddens here.
});

// ── #9 version-stamp ABSENCE — fail-OPEN (recorded as GAP-1 / ق17). A missing/null stamp is skipped, so
//    absence never produces STALE. This is the structurally-dead staleness gap; pinned, not fixed here. ──
check("#9 version-stamp absence does NOT trigger STALE (fail-open) — pinned as GAP-1 (ق17), not silently 'safe'", () => {
  const cfg = { ...V, decisionTable: [{ id: "r_0", kind: "COMMERCE", when: {}, result: "R1", proof: { product_id: PROVEN, match_state: "EXACT" } }] };
  const resolved = { scoring: { ruleId: "r_0" }, primary: { recommendations: { primary: { url: PROVEN } } } };
  const vr = verifyServedResult(cfg, resolved, {} /* no client stamps */);
  assert.equal(vr.stale, false, "PINNED: absent client stamps ⇒ not stale (fail-open) — tracked in KNOWN-GAPS GAP-1");
});

if (process.exitCode === 1) console.error("\nFAIL — a certificate-layer guard's vacuous behaviour changed unexpectedly.\n");
else console.log(`\nPASS — all ${passed} vacuous-truth audit assertions passed (guards examined + pinned).\n`);
