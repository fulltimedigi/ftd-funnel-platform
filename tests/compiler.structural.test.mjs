/**
 * tests/compiler.structural.test.mjs — the STRUCTURAL COMPILER, red-first (round-10, ADR-0058 §compiler).
 * The compiler turns a real oracle-authored tree into a CertificationInput carrying the tree STRUCTURE ONLY
 * (node_kind + children + accumulated answers + per-leaf kernel receipts). It performs ZERO matching, never
 * interprets a ref, and carries NO "why" (no display reason / axis grade / mirror share / rejection log / v10
 * trace). d* is computed from depth. A THIN CONSUMER (`verifyShapeAndCompleteness`) verifies shape + terminal
 * completeness from birth (the Certifier — full consumption + real mint rate — is phase 2).
 *
 * Done-definition (9 clauses, clause 6 modified per the operator): 1 real tree → CertificationInput · 2 zero
 * matching · 3 no ref interpreted · 4 all paths + terminal states preserved · 5 expected_reachable_paths>0 ·
 * 6 a THIN CONSUMER verifies shape+completeness (Certifier deferred to phase 2) · 7 coverage known · 8 a
 * deleted path reddens · 9 re-run ⇒ identical bytes.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AuthoringOracle } from "../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree } from "../authoring/brain2/tree.js";
import { compileTree, canonicalBytes, verifyShapeAndCompleteness, FORBIDDEN_KEYS } from "../authoring/compiler/structuralCompiler.js";
import { oudOneLevelInputs } from "./lib/oudUnits.mjs";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const inputs = await oudOneLevelInputs();
const limits = { ...inputs.treeLimits, leaf_primary_cap: inputs.leafCaps.primary };
const fresh = () => new AuthoringOracle({ units: inputs.units, resolvedContracts: inputs.resolvedContracts, context: inputs.context });
const compileOpts = { catalogVersion: inputs.context.structural_catalog_version, policyVersion: inputs.context.policy_version, kernelVersion: inputs.context.kernel_version, leafPrimaryCap: inputs.leafCaps.primary, displayPrimaryCap: inputs.leafCaps.display_primary, leafTotalCap: inputs.leafCaps.total };

const oracle = fresh();
const tree = buildFullTree(oracle, { limits });
const cinput = compileTree(oracle, tree, compileOpts);

check("1+4+5. a REAL tree → CertificationInput: all paths + terminal states preserved; expected_reachable_paths>0", () => {
  assert.equal(cinput.version, "cinput-1");
  assert.ok(cinput.expected_reachable_paths > 0, "expected_reachable_paths > 0");
  assert.equal(cinput.expected_reachable_paths, tree.leaves.length, "one path per leaf (all preserved)");
  console.log(`  · d*=${cinput.d_star} · expected_reachable_paths=${cinput.expected_reachable_paths} · nodes encoded=${countNodes(cinput.root)}`);
});

check("6. THIN CONSUMER (shape + completeness) accepts the compiled input — wired from birth", () => {
  const v = verifyShapeAndCompleteness(cinput);
  assert.ok(v.ok, "shape+completeness must pass: " + JSON.stringify(v.findings));
});

check("LEAK BOUNDARY: no forbidden 'why' key anywhere (reason/grade/mirror/rejection/rank/v10/penalized/evidence)", () => {
  const bytes = canonicalBytes(cinput);
  for (const k of FORBIDDEN_KEYS) assert.ok(!new RegExp(`"${k}"`).test(bytes), `forbidden key "${k}" leaked into CertificationInput`);
  // and the consumer independently flags a PLANTED leak
  const leaky = JSON.parse(bytes); leaky.root.mirror_singleton_share = 0.5;
  assert.ok(!verifyShapeAndCompleteness(leaky).ok, "a planted forbidden field must be rejected");
});

check("THE DECISIVE TEST: change the display-mode REASON with the structure fixed ⇒ BYTE-IDENTICAL output", () => {
  const bytes1 = canonicalBytes(cinput);
  const o2 = fresh(); const tree2 = buildFullTree(o2, { limits });
  // mutate every 'why' the tree carries — reasons, signals, rejections — WITHOUT touching structure
  for (const dm of tree2.displayModeNodes || []) dm.reason = "TOTALLY DIFFERENT REASON STRING ∎∎∎";
  for (const s of tree2.mirrorSignals || []) s.mirror_singleton_share = 0.999;
  for (const r of tree2.guardRejections || []) r.reason = "changed";
  const bytes2 = canonicalBytes(compileTree(o2, tree2, compileOpts));
  assert.equal(bytes2, bytes1, "the compiler must not branch on the WHY — identical structure ⇒ identical bytes");
});

check("9. RE-RUN ⇒ identical bytes (full determinism)", () => {
  const o3 = fresh(); const bytes3 = canonicalBytes(compileTree(o3, buildFullTree(o3, { limits }), compileOpts));
  assert.equal(bytes3, canonicalBytes(cinput), "recompiling the same tree yields identical bytes");
});

check("8. a DELETED path reddens the consumer (the gate is not theatre)", () => {
  const broken = JSON.parse(canonicalBytes(cinput));
  // find a question node and drop one of its children → a path disappears
  const q = findQuestion(broken.root);
  assert.ok(q, "found a question node");
  q.children = q.children.slice(0, -1);
  const v = verifyShapeAndCompleteness(broken);
  assert.ok(!v.ok, "dropping a child (a path) must fail shape+completeness: " + JSON.stringify(v.findings));
});

check("input-COMPLETENESS: every terminal/display leaf carries a kernel receipt with a state_outcome + non-empty pool", () => {
  walk(cinput.root, (n) => {
    if (n.node_kind === "question") { assert.ok(Array.isArray(n.children) && n.children.length, "a question has children"); return; }
    assert.ok(n.receipt && n.receipt.state_outcome, `leaf ${n.node_id} has a kernel receipt with state_outcome`);
    assert.ok((n.receipt.counts.exact + n.receipt.counts.compromise) > 0, "leaf is non-empty (no dead-end)");
  });
});

check("2+3. ZERO matching logic · no ref interpreted — the compiler imports no kernel/predicate/rule", () => {
  const src = readFileSync(join(ROOT, "authoring/compiler/structuralCompiler.js"), "utf8");
  for (const s of [...src.matchAll(/import\s[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1])) {
    assert.ok(!/constraintKernel|classifyUnit|\/select|axisRule|realCatalog|predicate/.test(s), `compiler imports matching logic: ${s}`);
  }
  assert.ok(!/membersOf\(/.test(src), "compiler must NOT resolve pool refs (no roster interpretation)");
  assert.ok(!/classifyUnit|\.select\(/.test(src), "compiler must NOT run matching");
});

function countNodes(n) { return 1 + (n.children || []).reduce((a, c) => a + countNodes(c.child), 0); }
function walk(n, fn) { fn(n); for (const c of n.children || []) walk(c.child, fn); }
function findQuestion(n) { if (n.node_kind === "question" && n.children && n.children.length > 1) return n; for (const c of n.children || []) { const r = findQuestion(c.child); if (r) return r; } return null; }

if (process.exitCode === 1) console.error("\nFAIL — the structural compiler violated a done-definition clause or the leak boundary.\n");
else console.log(`\nPASS — all ${passed} compiler checks: structure-only CertificationInput, thin consumer wired, byte-identical on reason change, deterministic, deleted-path reddens.\n`);
