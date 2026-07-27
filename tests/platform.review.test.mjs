/**
 * tests/platform.review.test.mjs — Studio review model (ADR-0023).
 *
 * The pure logic behind the review screen: green→ready, a failing gate→blocked
 * with the finding surfaced, and correct plain-language summary numbers. The HTML
 * page is a thin renderer over this and is browser-verified separately.
 */

import assert from "node:assert/strict";
import { buildReviewModel } from "../platform/review/reviewModel.js";

const CFG = {
  id: "brand-advisor",
  brand: { name: "متجر العود" },
  theme: "platform-clean", lang: "ar",
  questions: [{ text: "ما نوع العطر المفضّل؟" }, { text: "المناسبة؟" }],
  archetypes: [
    { recommendations: { primary: { name: "دهن عود كلمنتان" } } },
    { recommendations: { primary: { name: "معطّر مسك" } } },
    { recommendations: { primary: { name: "دهن عود كلمنتان" } } }, // dup name → counted once
  ],
};
const GREEN = { ok: true, findings: [] };

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

console.log("\nreview model:");

check("both gates green → ready (publishable)", () => {
  const m = buildReviewModel({ config: CFG, trust: GREEN, bland: GREEN });
  assert.equal(m.ok, true);
  assert.equal(m.status, "ready");
  assert.equal(m.blockers.length, 0);
  assert.ok(m.gates.every((g) => g.ok));
});

check("summary reports what it ASKS and what it RECOMMENDS", () => {
  const m = buildReviewModel({ config: CFG, trust: GREEN, bland: GREEN });
  assert.equal(m.summary.brand, "متجر العود");
  assert.equal(m.summary.questionCount, 2);
  assert.equal(m.summary.resultCount, 3);
  assert.equal(m.summary.firstQuestion, "ما نوع العطر المفضّل؟");
  assert.deepEqual(m.summary.recommends, ["دهن عود كلمنتان", "معطّر مسك"]); // dedup
  assert.equal(m.summary.productCount, 2);
});

check("a failing gate → blocked, and the finding is surfaced (never hidden)", () => {
  const bland = { ok: false, findings: [{ code: "BLAND_MIRROR", message: "السؤال مرآة للنتيجة" }] };
  const m = buildReviewModel({ config: CFG, trust: GREEN, bland });
  assert.equal(m.ok, false);
  assert.equal(m.status, "blocked");
  const blandGate = m.gates.find((g) => g.id === "bland");
  assert.equal(blandGate.ok, false);
  assert.equal(blandGate.findingCount, 1);
  assert.equal(blandGate.findings[0].code, "BLAND_MIRROR");
  assert.ok(m.blockers.some((b) => b.includes("الجودة")));
});

check("PROOF-COVERAGE gate (ADR-0041): a decision config with a proofless COMMERCE rule → blocked, never 'ready'", () => {
  const proofless = {
    ...CFG, scoring: { mode: "decision-table" },
    decisionTable: [
      { id: "r_0", kind: "COMMERCE", when: { D_x: "a" }, result: "R1", proof: { product_id: "u", match_state: "EXACT" } },
      { id: "r_1", kind: "COMMERCE", when: { D_x: "b" }, result: "R2" }, // NO proof → not publishable
    ],
  };
  const m = buildReviewModel({ config: proofless, trust: GREEN, bland: GREEN });
  assert.equal(m.ok, false, "trust+bland green is NOT enough — proof coverage < 100% blocks publish");
  const vGate = m.gates.find((g) => g.id === "verify");
  assert.ok(vGate && !vGate.ok, "the review screen shows the proof gate as failed (can't show stale green)");
  assert.ok(m.blockers.some((b) => b.includes("البرهان")), "the operator sees a proof-coverage blocker");
});

check("an authoritative verify result (passed by the caller) is honored over the config-only derivation", () => {
  const m = buildReviewModel({ config: CFG, trust: GREEN, bland: GREEN, verify: { ok: false, findings: [{ code: "PROOF_COVERAGE" }] } });
  assert.equal(m.ok, false, "a server-side verify failure blocks even a proof-carrying-looking config");
});

check("surfaces respondent step count in the 3–5 target (incl. email)", () => {
  const cfg = { ...CFG, leadForm: { gated: true, fields: [{ name: "email", type: "email" }] } };
  const m = buildReviewModel({ config: cfg, trust: GREEN, bland: GREEN });
  assert.equal(m.summary.steps, cfg.questions.length + 1); // 2 Q + email = 3
  assert.equal(m.summary.stepsInRange, true);
});

check("productCount prefers the catalog size when a catalog is present", () => {
  const m = buildReviewModel({ config: CFG, trust: GREEN, bland: GREEN, catalog: { products: [1, 2, 3, 4, 5] } });
  assert.equal(m.summary.productCount, 5);
});

check("no config → blocked with an honest blocker, no summary", () => {
  const m = buildReviewModel({ trust: GREEN, bland: GREEN });
  assert.equal(m.ok, false);
  assert.equal(m.summary, null);
  assert.ok(m.blockers.some((b) => b.includes("لم يتم إنشاء")));
});

if (process.exitCode === 1) console.error("\nFAIL — review model tests did not all pass.\n");
else console.log(`\nPASS — all ${passed} review-model assertions passed.\n`);
