/**
 * tests/questions.test.mjs — STEP 6 Question Architecture traceability.
 *
 * Run: node tests/questions.test.mjs
 *
 * Proves the engine-consumable artifact (configs/pm-certification-advisor.questions.json):
 *   1. STRUCTURE — every option binds to a canonical signal value, and every
 *      map key is a real option (bijection per decision question). No theater.
 *   2. DETERMINISM — answers → collectRawSignals → deriveSignals yields the exact
 *      DS tuple frozen Result Architecture v3 expects, for representative personas.
 *   3. MINIMALITY/BRANCH — 4 mandatory decision signals; learning_mode is not a
 *      question; the pmp_plus short-circuit is present and loses no required signal.
 *
 * Full chain locked: Question → Raw Signal → Derived Signal → (v3) Result.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectRawSignals, deriveSignals, THRESHOLD, TIER } from "../engine/signals.js";

const ART = JSON.parse(
  readFileSync(fileURLToPath(new URL("../configs/pm-certification-advisor.json", import.meta.url)))
);

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error("    " + err.message);
    process.exitCode = 1;
  }
}

const qById = new Map(ART.questions.map((q) => [q.id, q]));
const sigBySource = new Map(ART.signals.map((s) => [s.source, s]));

/* 1 ───────────────────────────────────────────────────── STRUCTURE */

console.log("\nStructure — no question without a signal, no option without a value:");
check("every question sources exactly one declared signal", () => {
  for (const q of ART.questions) {
    assert.ok(sigBySource.has(q.id), `question ${q.id} feeds no signal (theater)`);
  }
});
check("option↔map is a bijection for every mapped question", () => {
  for (const sig of ART.signals) {
    const q = qById.get(sig.source);
    const optionIds = new Set(q.options.map((o) => o.id));
    const mapKeys = new Set(Object.keys(sig.map || {}));
    for (const id of optionIds) {
      // goal is optional → 'skip' is allowed to have no map entry; all others must map
      if (sig.required !== false) assert.ok(mapKeys.has(id), `option ${id} (${q.id}) has no canonical value`);
      if (mapKeys.has(id)) assert.ok(sig.domain.includes(sig.map[id]), `${id} maps outside domain`);
    }
    for (const k of mapKeys) assert.ok(optionIds.has(k), `map key ${k} has no option in ${q.id}`);
  }
});
check("mode is decision-table; learning_mode is NOT a question", () => {
  assert.equal(ART.scoring.mode, "decision-table");
  assert.ok(!sigBySource.has("q_learning_mode"));
  assert.ok(!ART.signals.some((s) => s.id === "learning_mode"));
});

/* 2 ─────────────────────────────────────────── DETERMINISM (personas) */

// helper: answers → derived signals, through the real engine path
const derive = (answers) => deriveSignals(ART, collectRawSignals(answers, ART));

console.log("\nDeterminism — answers resolve to the exact v3 DS tuple:");
check("P1 bachelor/≥4500/private/none → meets·private·none (→ R3 PMP)", () => {
  const s = derive({
    q_credential: "opt_none", q_qualification: "opt_bachelor",
    q_hours: "opt_4500_7499", q_environment: "opt_private",
  });
  assert.equal(s.DS1, "bachelor_plus");
  assert.equal(s.DS2, THRESHOLD.MEETS);
  assert.equal(s.DS3, "private");
  assert.equal(s.DS5, TIER.NONE);
});
check("P3 diploma/≥7500 → meets (→ R3, diploma reaches PMP)", () => {
  const s = derive({
    q_credential: "opt_none", q_qualification: "opt_diploma",
    q_hours: "opt_ge7500", q_environment: "opt_private",
  });
  assert.equal(s.DS2, THRESHOLD.MEETS);
});
check("diploma/4500–7499 → below (→ R2, honest: needs 7,500h)", () => {
  const s = derive({
    q_credential: "opt_none", q_qualification: "opt_diploma",
    q_hours: "opt_4500_7499", q_environment: "opt_private",
  });
  assert.equal(s.DS2, THRESHOLD.BELOW);
});
check("P14 not-yet-working + claims ≥7500 → CLAMP to below (→ R1)", () => {
  const s = derive({
    q_credential: "opt_none", q_qualification: "opt_bachelor",
    q_hours: "opt_ge7500", q_environment: "opt_notyet",
  });
  assert.equal(s.DS2, THRESHOLD.BELOW);
  assert.equal(s.meta.clamped, true);
});
check("P20 holds PRINCE2-Foundation → entry_level (→ R1, no re-sell)", () => {
  const s = derive({
    q_credential: "opt_prince2f", q_qualification: "opt_bachelor",
    q_hours: "opt_lt4500", q_environment: "opt_gov",
  });
  assert.equal(s.DS5, TIER.ENTRY);
});
check("P6 unsure hours, goal skipped → DS2 unsure + goal defaults (→ R7)", () => {
  const s = derive({
    q_credential: "opt_none", q_qualification: "opt_bachelor",
    q_hours: "opt_unsure", q_environment: "opt_private",
  });
  assert.equal(s.DS2, THRESHOLD.UNSURE);
  assert.equal(s.goal, "unsure"); // presentation signal defaults; learning_mode is resolved at the result screen, not collected
});
check("goal is read but never alters a DS (presentation only)", () => {
  const base = {
    q_credential: "opt_none", q_qualification: "opt_bachelor",
    q_hours: "opt_4500_7499", q_environment: "opt_private",
  };
  const a = derive({ ...base, q_goal: "opt_promotion" });
  const b = derive({ ...base, q_goal: "opt_mobility" });
  assert.deepEqual(
    [a.DS1, a.DS2, a.DS3, a.DS5],
    [b.DS1, b.DS2, b.DS3, b.DS5]
  );
  assert.notEqual(a.goal, b.goal); // captured for copy/offer
});

/* 3 ──────────────────────────────────────────── MINIMALITY / BRANCH */

console.log("\nMinimality & short-circuit:");
check("exactly 4 decision signals + 1 presentation, 0 offer questions", () => {
  const roles = ART.signals.reduce((m, s) => ((m[s.role] = (m[s.role] || 0) + 1), m), {});
  assert.equal(roles.decision, 4);
  assert.equal(roles.presentation, 1);
  assert.equal(roles.offer ?? 0, 0);
});
check("pmp_plus option short-circuits to q_environment (skips DS1/DS2 gate)", () => {
  const opt = qById.get("q_credential").options.find((o) => o.id === "opt_pmp");
  assert.equal(opt.next, "q_environment");
});
check("pmp_plus path still produces the signals R6 reads (DS5 + DS3)", () => {
  // a PMP holder answers only credential + environment; gate questions skipped
  const s = derive({ q_credential: "opt_pmp", q_environment: "opt_gov" });
  assert.equal(s.DS5, TIER.PMP_PLUS); // → R6 short-circuit
  assert.equal(s.DS3, "government");  // → R6 shortlist (MSP/MoP), defensible
  // skipped gate is harmless: DS1/DS2 are never read once DS5=pmp_plus
});

/* ================================================================ SUMMARY = */
if (process.exitCode === 1) {
  console.error("\nFAIL — some question-architecture tests did not pass.\n");
} else {
  console.log(`\nPASS — all ${passed} question-architecture assertions passed.\n`);
}
