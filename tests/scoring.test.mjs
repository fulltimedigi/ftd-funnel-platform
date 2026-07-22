/**
 * tests/scoring.test.mjs — Console tests for engine/scoring.js (SPEC §8, §16).
 *
 * Run: node tests/scoring.test.mjs   (exits non-zero if any assertion fails)
 *
 * Covers all three modes with sample funnel data:
 *   - weighted-multi : FreelanceX-style (question weights + flag adjustments)
 *   - dominant       : ASQ-style (proves EVERY question affects the result)
 *   - sum-band       : FT-Builder-style sanity check (band lookup)
 */

import assert from "node:assert/strict";
import { score } from "../engine/scoring.js";

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

/* ============================================================ SAMPLE DATA = */

/**
 * FreelanceX — weighted-multi. Question weights matter; URGENT flag adjusts.
 */
const FREELANCEX = {
  id: "freelancex",
  scoring: { mode: "weighted-multi" },
  archetypes: [
    { id: "copywriting", name: "الكوبي رايتينج" },
    { id: "development", name: "البرمجة" },
    { id: "freelance_start", name: "من الصفر" },
    { id: "ai_automation", name: "الأتمتة" },
  ],
  flags: [
    {
      id: "URGENT",
      adjustments: {
        freelance_start: 5,
        copywriting: 3,
        development: -4,
        ai_automation: -4,
      },
    },
  ],
  questions: [
    {
      id: "q1",
      weight: 1,
      options: [
        { id: "a", score: { freelance_start: 3, copywriting: 2 }, flag: "URGENT" },
        { id: "b", score: { development: 3, ai_automation: 2 } },
      ],
    },
    {
      id: "q2",
      weight: 2,
      options: [
        { id: "a", score: { copywriting: 5 } },
        { id: "b", score: { development: 5 } },
      ],
    },
    {
      id: "q3",
      weight: 1,
      options: [
        { id: "a", score: { copywriting: 2, freelance_start: 1 } },
        { id: "b", score: { development: 2 } },
      ],
    },
  ],
};

/**
 * ASQ — dominant. Designed so the result depends on Q2 and Q3, not just Q1.
 */
const ASQ = {
  id: "asq-perfume",
  scoring: { mode: "dominant" },
  archetypes: [
    { id: "rooted", name: "الحضور الراسخ" },
    { id: "intimate", name: "الأثر الحميمي" },
    { id: "radiant", name: "الحضور المُشِع" },
    { id: "warm", name: "الدفء الرومانسي" },
  ],
  questions: [
    {
      id: "identity",
      options: [
        { id: "rooted", score: { rooted: 2 } },
        { id: "intimate", score: { intimate: 2 } },
        { id: "radiant", score: { radiant: 2 } },
        { id: "warm", score: { warm: 2 } },
      ],
    },
    {
      id: "scent",
      options: [
        { id: "oud", score: { rooted: 2, radiant: 1 } },
        { id: "musk", score: { intimate: 2 } },
        { id: "sweet", score: { warm: 2 } },
        { id: "floral", score: { warm: 1, radiant: 1 } },
      ],
    },
    {
      id: "occasion",
      options: [
        { id: "majlis", score: { rooted: 1, intimate: 1 } },
        { id: "daily", score: { radiant: 1 } },
        { id: "special", score: { warm: 1 } },
        { id: "social", score: { radiant: 1, warm: 1 } },
      ],
    },
  ],
};

/**
 * FT-Builder-style — sum-band sanity check.
 */
const SUMBAND = {
  id: "freelancer-maturity",
  scoring: { mode: "sum-band" },
  archetypes: [
    { id: "beginner", name: "المبتدئ", band: { min: 0, max: 6 } },
    { id: "artist", name: "الفنان", band: { min: 7, max: 12 } },
    { id: "pro", name: "المحترف", band: { min: 13, max: 18 } },
    { id: "entrepreneur", name: "رائد الأعمال", band: { min: 19, max: 24 } },
  ],
  questions: [
    { id: "q1", options: [{ id: "a", score: 1 }, { id: "b", score: 3 }] },
    { id: "q2", options: [{ id: "a", score: 0 }, { id: "b", score: 2 }] },
    { id: "q3", options: [{ id: "a", score: 2 }, { id: "b", score: 3 }] },
  ],
};

/* ================================================================= TESTS = */

console.log("\nFreelanceX (weighted-multi):");
check("output has the 5-key shape", () => {
  const r = score(FREELANCEX, { q1: "a", q2: "a", q3: "a" });
  assert.deepEqual(Object.keys(r).sort(), [
    "flags",
    "primary",
    "scores",
    "secondary",
    "sorted",
  ]);
});
check("weights multiply (q2 weight 2) and URGENT flag adjusts", () => {
  const r = score(FREELANCEX, { q1: "a", q2: "a", q3: "a" });
  // copywriting: 2 + (5*2) + 2 = 14, +3 URGENT = 17
  // freelance_start: 3 + 1 = 4, +5 URGENT = 9
  // development: 0, -4 URGENT clamped to 0; ai_automation: 0 clamped
  assert.equal(r.scores.copywriting, 17);
  assert.equal(r.scores.freelance_start, 9);
  assert.equal(r.scores.development, 0);
  assert.equal(r.scores.ai_automation, 0);
});
check("primary/secondary/flags/sorted correct", () => {
  const r = score(FREELANCEX, { q1: "a", q2: "a", q3: "a" });
  assert.equal(r.primary, "copywriting");
  assert.equal(r.secondary, "freelance_start");
  assert.deepEqual(r.flags, ["URGENT"]);
  // zero-score archetypes filtered out of sorted
  assert.deepEqual(r.sorted, [
    ["copywriting", 17],
    ["freelance_start", 9],
  ]);
});
check("different answers → different result (development path, no flag)", () => {
  const r = score(FREELANCEX, { q1: "b", q2: "b", q3: "b" });
  // development: 3 + (5*2) + 2 = 15 ; ai_automation: 2
  assert.equal(r.primary, "development");
  assert.equal(r.scores.development, 15);
  assert.deepEqual(r.flags, []);
});

console.log("\nASQ (dominant) — proves every question affects the result:");
check("primary is decided by Q2+Q3, not Q1 alone", () => {
  // Q1=intimate(+2 intimate). Q2=oud(+2 rooted,+1 radiant). Q3=majlis(+1 rooted,+1 intimate)
  // totals: rooted=3, intimate=3, radiant=1, warm=0
  // tie rooted/intimate broken by declaration order → rooted first.
  const r = score(ASQ, { identity: "intimate", scent: "oud", occasion: "majlis" });
  assert.equal(r.scores.rooted, 3);
  assert.equal(r.scores.intimate, 3);
  assert.equal(r.scores.radiant, 1);
  assert.equal(r.scores.warm, 0);
  assert.equal(r.primary, "rooted"); // NOT "intimate" — Q1 did not dominate
  assert.equal(r.secondary, "intimate");
});
check("changing only Q1 changes the outcome", () => {
  const r = score(ASQ, { identity: "warm", scent: "oud", occasion: "majlis" });
  // rooted = 2(oud)+1(majlis)=3 ; warm=2 ; intimate=1 ; radiant=1
  assert.equal(r.primary, "rooted");
  assert.equal(r.scores.warm, 2);
});
check("zero-score archetypes are filtered from sorted", () => {
  const r = score(ASQ, { identity: "intimate", scent: "oud", occasion: "majlis" });
  assert.ok(r.sorted.every(([, v]) => v > 0));
  assert.equal(r.sorted.length, 3); // warm (0) excluded
});

console.log("\nFT-Builder (sum-band):");
check("total maps to the containing band; secondary = nearest adjacent", () => {
  // answers a,b,a → 1 + 2 + 2 = 5 → beginner band (0–6)
  const r = score(SUMBAND, { q1: "a", q2: "b", q3: "a" });
  assert.equal(r.primary, "beginner");
  assert.equal(r.secondary, "artist");
  assert.equal(r.scores.beginner, 0); // total inside band → proximity 0
  assert.equal(r.scores.artist, -2); // 7 - 5
});
check("higher total lands in a higher band", () => {
  // answers b,b,b → 3 + 2 + 3 = 8 → artist band (7–12)
  const r = score(SUMBAND, { q1: "b", q2: "b", q3: "b" });
  assert.equal(r.primary, "artist");
  assert.equal(r.scores.artist, 0);
});

console.log("\nEdge cases:");
check("unknown mode throws", () => {
  assert.throws(() => score({ scoring: { mode: "nope" }, archetypes: [], questions: [] }, {}));
});
check("missing scoring config throws", () => {
  assert.throws(() => score({}, {}));
});
check("array-form answers are accepted", () => {
  const r = score(FREELANCEX, [
    { questionId: "q1", optionId: "a" },
    { questionId: "q2", optionId: "a" },
    { questionId: "q3", optionId: "a" },
  ]);
  assert.equal(r.primary, "copywriting");
});
check("unknown question/option answers are ignored", () => {
  const r = score(FREELANCEX, { nope: "x", q1: "a", q2: "zzz" });
  // only q1=a counts: copywriting 2(+3 URGENT)=5, freelance_start 3(+5)=8
  assert.equal(r.primary, "freelance_start");
  assert.deepEqual(r.flags, ["URGENT"]);
});

/* ================================================================ SUMMARY = */
if (process.exitCode === 1) {
  console.error("\nFAIL — some scoring tests did not pass.\n");
} else {
  console.log(`\nPASS — all ${passed} scoring assertions passed.\n`);
}
