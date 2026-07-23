/**
 * tests/author.antibland.test.mjs — Anti-Bland quality gate (ADR-0016).
 *
 * Teeth test: the gate must PASS the reference funnel and REJECT each bland
 * pattern — a mirror question (single signal → result 1:1), single-question
 * dominance, and a result with no why-not. "A gate that can't fail is theater."
 * Offline, synthetic + reference fixtures. No deps.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { antiBlandCheck } = await import("../authoring/author/qualityGate.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const pm = JSON.parse(readFileSync(join(__dirname, "../configs/pm-certification-advisor.json"), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const codes = (r) => r.findings.map((f) => f.code);

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

/** Build a minimal archetype with a real SKU, a why, and a why-not. */
function arch(id, whyNot = true) {
  const a = {
    id, name: `Result ${id}`, description: `desc ${id}`,
    recommendations: { primary: { name: `Product ${id}`, url: `https://shop.example/products/${id.toLowerCase()}`, becauseTemplate: `«Product ${id}» يناسب اختيارك.` } },
    resultExtras: { why: [{ needs: {}, claim: `«Product ${id}» يطابق ما تبحث عنه.` }], nextAction: `اطلب Product ${id}.` },
  };
  if (whyNot) a.resultExtras.whyNot = [{ name: "بديل", needs: {}, claim: `«Product ${id}» يتميّز بخاصية لا تتوفر في البدائل.` }];
  return a;
}
const q = (id, opts) => ({ id, label: id, text: `q ${id}`, options: opts.map((o) => ({ id: o, label: o })) });

await (async () => {
  console.log("\nthe gate PASSES a sound funnel:");
  await check("the reference PM Certification Advisor passes anti-bland", () => {
    const r = antiBlandCheck(pm);
    assert.equal(r.ok, true, JSON.stringify(r.findings, null, 2));
  });

  console.log("\nthe gate REJECTS bland patterns:");
  await check("mirror question (one signal → result 1:1) is rejected", () => {
    const mirror = {
      id: "m", brand: { name: "M" }, theme: "platform-clean", lang: "ar", hero: {}, resultLayout: "commerce",
      scoring: { mode: "decision-table" },
      signals: [{ id: "s1", role: "decision", required: true, source: "q1", domain: ["a", "b"], map: { o1: "a", o2: "b" } }],
      derivedSignals: [{ id: "D1", from: ["s1"], rule: "identity", domain: ["a", "b"] }],
      decisionTable: [{ when: { D1: "a" }, result: "R1" }, { when: { D1: "b" }, result: "R2" }, { when: {}, result: "R1" }],
      archetypes: [arch("R1"), arch("R2")],
      questions: [q("q1", ["o1", "o2"])],
      leadForm: {}, cta: {}, analytics: {},
    };
    const r = antiBlandCheck(mirror);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("BLAND_MIRROR"), "expected BLAND_MIRROR");
  });

  await check("single-question dominance (>50%, not a mirror) is rejected", () => {
    // 2 signals, 4 cells: D1 decides 2/3 pivots, D2 1/3 → D1 dominates but result is
    // NOT a function of D1 alone (D1=b splits to R2/R3), so it's dominance, not mirror.
    const dom = {
      id: "d", brand: { name: "D" }, theme: "platform-clean", lang: "ar", hero: {}, resultLayout: "commerce",
      scoring: { mode: "decision-table" },
      signals: [
        { id: "s1", role: "decision", required: true, source: "q1", domain: ["a", "b"], map: { o1: "a", o2: "b" } },
        { id: "s2", role: "decision", required: true, source: "q2", domain: ["a", "b"], map: { p1: "a", p2: "b" } },
      ],
      derivedSignals: [
        { id: "D1", from: ["s1"], rule: "identity", domain: ["a", "b"] },
        { id: "D2", from: ["s2"], rule: "identity", domain: ["a", "b"] },
      ],
      decisionTable: [
        { when: { D1: "a" }, result: "R1" },
        { when: { D1: "b", D2: "a" }, result: "R2" },
        { when: { D1: "b", D2: "b" }, result: "R3" },
        { when: {}, result: "R1" },
      ],
      archetypes: [arch("R1"), arch("R2"), arch("R3")],
      questions: [q("q1", ["o1", "o2"]), q("q2", ["p1", "p2"])],
      leadForm: {}, cta: {}, analytics: {},
    };
    const r = antiBlandCheck(dom);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("BLAND_DOMINANCE"), "expected BLAND_DOMINANCE");
    assert.ok(!codes(r).includes("BLAND_MIRROR"), "should be dominance, not mirror");
  });

  await check("a result with no why-not is rejected", () => {
    const c = clone(pm);
    delete c.archetypes.find((a) => a.id === "R3").resultExtras.whyNot;
    const r = antiBlandCheck(c);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("BLAND_NO_WHYNOT"));
  });

  await check("a result with no real product URL is rejected", () => {
    const c = clone(pm);
    delete c.archetypes.find((a) => a.id === "R3").recommendations.primary.url;
    const r = antiBlandCheck(c);
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes("BLAND_NO_REAL_SKU"));
  });

  if (process.exitCode === 1) console.error("\nFAIL — anti-bland tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} anti-bland assertions passed.\n`);
})();
