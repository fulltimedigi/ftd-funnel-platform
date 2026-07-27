/**
 * tests/cleanroom.test.mjs — STEP 4-a0 (ADR-0045): the clean-room input boundary is fail-closed, and the
 * forbidden-DATA-lineage scan catches contamination smuggled as data (not just imports). Poison-verified.
 */
import assert from "node:assert/strict";
import { buildInputManifest, forbiddenLineageHits } from "../authoring/brain2/cleanRoom.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const allowed = () => [
  { name: "oudfactory.products.json", kind: "raw_catalog_snapshot", content: { products: [{ url: "u", title: "t", variants: [{ price: "10" }] }] } },
  { name: "ledger", kind: "sku_ledger", content: { skus: [{ sku_id: "s1", buy_url: "u" }] } },
  { name: "policy", kind: "current_policy", content: { constraints: [{ id: "budget", mode: "budget_ceiling" }] } },
  { name: "gold-1.0.0", kind: "frozen_gold", content: { intents: [{ id: "i1", expected: { match_state: "EXACT" } }] } }, // truth label — exempt
];

check("a manifest of ALLOWED primary sources builds, each hashed with provenance", () => {
  const m = buildInputManifest(allowed());
  assert.equal(m.length, 4);
  assert.ok(m.every((x) => x.hash && x.kind), "every input carries a kind + content hash");
});

check("EMPTY input set is refused (an empty clean room is not a clean room — fail-closed)", () => {
  assert.throws(() => buildInputManifest([]), /empty input set/);
});

check("a FORBIDDEN input KIND (legacy brain output) is refused", () => {
  assert.throws(() => buildInputManifest([...allowed(), { name: "old-tree", kind: "decision_tree_output", content: {} }]), /FORBIDDEN input kind/);
});

check("an allowed-kind input smuggling legacy lineage as DATA is refused (data-level, not imports)", () => {
  const poisoned = [{ name: "catalog?", kind: "raw_catalog_snapshot", content: { products: [], decisionTable: [{ id: "r0" }] } }];
  assert.throws(() => buildInputManifest(poisoned), /LEGACY-MATCHER lineage/);
  const poisoned2 = [{ name: "catalog?", kind: "raw_catalog_snapshot", content: { archetypes: [{ id: "R1" }] } }];
  assert.throws(() => buildInputManifest(poisoned2), /LEGACY-MATCHER lineage/);
});

check("frozen_gold truth labels (match_state) are EXEMPT from the legacy-output scan", () => {
  // gold carries expected match_state as reviewed TRUTH, not a legacy computation → allowed
  const m = buildInputManifest(allowed());
  assert.ok(m.find((x) => x.kind === "frozen_gold"), "gold is accepted despite carrying a match_state truth label");
});

check("POISON CANARY: the forbidden-lineage scanner actually bites on planted keys", () => {
  assert.deepEqual(forbiddenLineageHits({ a: { b: { decisionTable: 1 } } }), ["a.b.decisionTable"]);
  assert.ok(forbiddenLineageHits({ leaves: [{ scores: {} }] }).length >= 1, "catches leaves + scores");
  assert.deepEqual(forbiddenLineageHits({ questions: [{ options: [{ axis_ref: "A" }] }] }), [], "clean structural data has no hits");
});

if (process.exitCode === 1) console.error("\nFAIL — the clean-room boundary let contamination through.\n");
else console.log(`\nPASS — all ${passed} clean-room assertions passed.\n`);
