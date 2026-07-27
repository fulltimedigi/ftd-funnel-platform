/**
 * tests/reference-classification.test.mjs — STEP 1 invariant (ADR-0041). Turns the reference-config
 * decision into a LIVE guard instead of a standing explained-away exception:
 *
 *   every shipped COMMERCE config in configs/ either
 *     (a) carries proofs (kernel-authored → renders through the certificate), OR
 *     (b) is EXPLICITLY classified reference-only in configs/_classification.json.
 *
 * So a NEW proofless commerce config added to configs/ is a RED (author it through the pipeline, or
 * classify it) — never a silent proofless card served to a visitor. The classification is visible and
 * enforced, not a comment someone re-explains each time a check goes red.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../configs/", import.meta.url);
const classification = JSON.parse(readFileSync(new URL("_classification.json", dir), "utf8"));
const referenceOnly = new Set(Object.keys(classification.reference_only || {}));

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
const isCommerce = (c) => c && c.resultLayout === "commerce" && c.scoring && c.scoring.mode === "decision-table";
const hasProofs = (c) => Array.isArray(c.decisionTable) && c.decisionTable.some((r) => r && r.proof);

check("every shipped COMMERCE config either carries proofs OR is classified reference-only (no silent proofless funnel)", () => {
  const unresolved = [];
  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    const cfg = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    if (!isCommerce(cfg)) continue;                 // non-commerce (e.g. tracks) — no product-cert concept
    if (hasProofs(cfg)) continue;                   // kernel-authored → certificate path
    if (!referenceOnly.has(id)) unresolved.push(id); // proofless commerce, NOT classified → must resolve
  }
  assert.deepEqual(unresolved, [], `proofless COMMERCE config(s) neither proven nor classified reference-only: ${unresolved.join(", ") || "none"} — author through the pipeline or add to configs/_classification.json`);
});

check("classification lists only real config ids (no stale entries)", () => {
  const ids = new Set(files.map((f) => f.replace(/\.json$/, "")));
  const stale = [...referenceOnly].filter((id) => !ids.has(id));
  assert.deepEqual(stale, [], `stale reference-only entries (no such config): ${stale.join(", ")}`);
});

if (process.exitCode === 1) console.error("\nFAIL — a served commerce config is neither proven nor classified.\n");
else console.log(`\nPASS — all ${passed} reference-classification assertions passed.\n`);
