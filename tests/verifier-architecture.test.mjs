/**
 * tests/verifier-architecture.test.mjs — the verifier's INDEPENDENCE is structural (ADR-0037
 * closing, item 4). The reference oracle and the publish-time verifier must NOT import the kernel's
 * winner-selection machinery (select / lossVector / compareLoss / eligibility / tie-break). They may
 * share only the base predicates (status / evaluateUnit). This test reads the source and FAILS CI on
 * a forbidden import — so no future edit can quietly make the "independent" check depend on the thing
 * it is meant to check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const FORBIDDEN = ["select", "lossVector", "compareLoss", "eligibility"]; // the matcher's chooser
const ALLOWED = ["status", "evaluateUnit"]; // shared base predicates

/** Names imported from constraintKernel.js in a source file. */
function kernelImports(src) {
  const names = new Set();
  const re = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*constraintKernel\.js["']/g;
  let m;
  while ((m = re.exec(src))) for (const part of m[1].split(",")) {
    const id = part.trim().split(/\s+as\s+/)[0].trim();
    if (id) names.add(id);
  }
  return names;
}

check("referenceEvaluator does NOT import the kernel's selection machinery", () => {
  const imp = kernelImports(read("../engine/kernel/referenceEvaluator.js"));
  for (const f of FORBIDDEN) assert.ok(!imp.has(f), `referenceEvaluator must not import "${f}" from the kernel`);
  assert.ok([...imp].some((n) => ALLOWED.includes(n)), "it does share the base predicates (status/evaluateUnit)");
});

check("verifyFunnel does NOT import the kernel's selection machinery (select/comparator/loss)", () => {
  const imp = kernelImports(read("../engine/kernel/verifyFunnel.js"));
  for (const f of FORBIDDEN) assert.ok(!imp.has(f), `verifyFunnel must not import "${f}" from the kernel`);
});

check("promiseBinding shares only base predicates, not the chooser", () => {
  const imp = kernelImports(read("../engine/kernel/promiseBinding.js"));
  for (const f of FORBIDDEN) assert.ok(!imp.has(f), `promiseBinding must not import "${f}"`);
});

if (process.exitCode === 1) console.error("\nFAIL — verifier independence breached at the import boundary.\n");
else console.log(`\nPASS — all ${passed} architecture assertions passed.\n`);
