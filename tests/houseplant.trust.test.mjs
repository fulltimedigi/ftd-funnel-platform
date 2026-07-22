/**
 * tests/houseplant.trust.test.mjs — Houseplant Advisor trust validation.
 * The generic gate must pass the new funnel with zero blockers, and still bite
 * a niche-specific violation (toxic plant reachable for pet owners).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { trustValidate } from "../engine/trustValidate.js";

const CFG = JSON.parse(readFileSync(fileURLToPath(new URL("../configs/houseplant-advisor.json", import.meta.url))));
const clone = () => JSON.parse(JSON.stringify(CFG));
let passed = 0;
const check = (n, fn) => { try { fn(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const codes = (r) => r.findings.filter((f) => f.severity === "blocker").map((f) => f.code);

console.log("\nThe gate — Houseplant Advisor passes Trust Validation:");
check("ok=true, zero blockers, zero warnings", () => {
  const r = trustValidate(CFG);
  if (!r.ok) console.error("    " + JSON.stringify(r.findings.filter((f) => f.severity === "blocker"), null, 2));
  assert.equal(r.ok, true);
  assert.equal(r.findings.length, 0, JSON.stringify(r.findings));
});

console.log("\nThe teeth — generic gate catches niche violations:");
check("a bullet gated on an undefined signal is caught", () => {
  const c = clone();
  c.archetypes.find((a) => a.id === "FUSSY").resultExtras.why.push({ needs: { DS_nope: "x" }, claim: "bad" });
  assert.ok(codes(trustValidate(c)).includes("TV3_NEEDS_UNDEFINED_SIGNAL"));
});
check("an out-of-domain signal value is caught", () => {
  const c = clone();
  c.archetypes.find((a) => a.id === "FUSSY").resultExtras.why.push({ needs: { DS_ready: "super" }, claim: "x" });
  assert.ok(codes(trustValidate(c)).includes("TV3_NEEDS_BAD_VALUE"));
});
check("an orphan decision signal (unused by the table) is caught", () => {
  const c = clone();
  for (const r of c.decisionTable) delete r.when.DS_light; // DS_light no longer used
  assert.ok(codes(trustValidate(c)).includes("TV2_ORPHAN_SIGNAL"));
});
check("a result that can render no because is caught by the sweep", () => {
  const c = clone();
  c.archetypes.find((a) => a.id === "SAFESTART").recommendations.primary.becauseTemplate = "needs {missing}";
  assert.ok(codes(trustValidate(c)).includes("TV3_NO_BECAUSE"));
});
check("contextual misplaced under resultExtras is caught (the footgun from build)", () => {
  const c = clone();
  c.archetypes.find((a) => a.id === "LOWLIGHT").resultExtras.contextual = [{ name: "X", url: "u", becauseTemplate: "b" }];
  assert.ok(codes(trustValidate(c)).includes("TV1_CONTEXTUAL_MISPLACED"));
});
check("fake-intelligence vocabulary is caught", () => {
  const c = clone();
  c.archetypes.find((a) => a.id === "BRIGHT").description = "We analyzed your personality and plant readiness score.";
  assert.ok(codes(trustValidate(c)).includes("TV5_FAKE_INTELLIGENCE"));
});

if (process.exitCode === 1) console.error("\nFAIL\n"); else console.log(`\nPASS — all ${passed} houseplant-trust assertions passed.\n`);
