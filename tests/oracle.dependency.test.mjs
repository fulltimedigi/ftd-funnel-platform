/**
 * tests/oracle.dependency.test.mjs — STEP 4-a OWNERSHIP + DEPENDENCY-GRAPH proof.
 * ===========================================================================================
 * Two structural guarantees the contract demands, enforced as a build gate:
 *   (1) OWNERSHIP — the oracle (matching/partition logic) lives under engine/kernel/authoringOracle/,
 *       NOT under authoring/brain2/. If matching ever moved into the brain's folder, a second matcher
 *       would exist organizationally — forbidden.
 *   (2) THIN CLIENT — no file under authoring/brain2/ may import a MATCHING PREDICATE (the kernel, the
 *       oracle's evaluator, the certifier, the reference evaluator, the policy registry, runtime
 *       verification). The brain consumes only the opaque AUTHORING PROJECTION as DATA — it never
 *       imports code that can interpret a constraint or test a SKU.
 * This is red-first: planting a forbidden import in brain2 (or moving the oracle under brain2) reddens it.
 */
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

function jsFiles(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(join(dir, name)));
    else if (name.endsWith(".js")) out.push({ rel: join(dir, name), src: readFileSync(p, "utf8") });
  }
  return out;
}

const importSpecifiers = (src) => [...src.matchAll(/import\s[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1])
  .concat([...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]));

// module-path fragments that are MATCHING PREDICATES — brain2 must never import any of these.
const FORBIDDEN = [
  "constraintKernel", "authoringOracle/evaluateState", "authoringOracle/classify", "classifyUnit",
  "certifyForRender", "referenceEvaluator", "policyRegistry", "verifyRuntime", "verifyFunnel",
  "engine/kernel/compile", "engine/decision", "engine/scoring",
];

check("OWNERSHIP — the oracle evaluator lives in the kernel path, NOT under authoring/brain2/", () => {
  assert.ok(existsSync(join(ROOT, "engine/kernel/authoringOracle/evaluateState.js")), "evaluateState is kernel-owned");
  assert.ok(!existsSync(join(ROOT, "authoring/brain2/evaluateState.js")), "no evaluator under brain2");
  assert.ok(!existsSync(join(ROOT, "authoring/brain2/classifyUnit.js")), "no classifier under brain2");
  // brain2 must not host any file whose name advertises matching logic
  for (const { rel } of jsFiles("authoring/brain2")) {
    assert.ok(!/(classify|evaluate|match|predicate|select)/i.test(rel), `brain2 file "${rel}" must not host matching logic (ownership)`);
  }
});

check("THIN CLIENT — no authoring/brain2/ file imports a matching predicate", () => {
  const files = jsFiles("authoring/brain2");
  assert.ok(files.length >= 1, "brain2 exists (at least the clean room)");
  for (const { rel, src } of files) {
    for (const spec of importSpecifiers(src)) {
      for (const bad of FORBIDDEN) {
        assert.ok(!spec.includes(bad), `brain2 file "${rel}" imports a forbidden matching predicate: "${spec}" (matches ${bad})`);
      }
    }
  }
});

check("THIN CLIENT — no brain2 file reaches into engine/kernel at all (the brain gets DATA, not predicates)", () => {
  for (const { rel, src } of jsFiles("authoring/brain2")) {
    for (const spec of importSpecifiers(src)) {
      assert.ok(!spec.includes("engine/kernel"), `brain2 file "${rel}" reaches into engine/kernel via "${spec}" — the brain is a thin client`);
    }
  }
});

if (process.exitCode === 1) console.error("\nFAIL — an ownership / thin-client boundary was violated.\n");
else console.log(`\nPASS — all ${passed} ownership + dependency-graph assertions passed.\n`);
