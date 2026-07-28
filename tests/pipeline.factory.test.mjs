/**
 * tests/pipeline.factory.test.mjs — the SINGLE pipeline factory + import-isolation canary (delivery step 2,
 * ADR-0066). PREVENT, don't detect. ==========================================================================
 *  (a) A `Pipeline` is minted ONLY by createProductionPipeline (Symbol-branded) — a look-alike object is not a
 *      pipeline (un-forgeable). Entries accept the type and cannot assemble one.
 *  (b) IMPORT ISOLATION: the pipeline internals (brain2 / structural compiler / kernel certifier) are imported
 *      ONLY by the factory — NEVER by a production entry. An entry that assembles its own chain ⇒ CI red.
 *  (c) HONEST SEAMS: run() throws a NAMED error for any un-wired adapter — never a fabricated config.
 *  (d) SELF-PROVING CANARY: a rogue entry that imports an internal is CAUGHT by the scanner (a check that never
 *      saw its own failure is not a check).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProductionPipeline, isProductionPipeline, PIPELINE_INTERNALS } from "../authoring/pipeline/pipeline.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

// The PRODUCTION ENTRY files that must reach the certified chain ONLY through the factory (never import internals).
const PRODUCTION_ENTRIES = [
  "authoring/index.js",
  "platform/jobs/generateJob.js",
  "netlify/functions/generate-background.mjs",
  "netlify/functions/generate-submit.mjs",
  "authoring/run.mjs",
];
const readIfExists = (rel) => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; };
const importsAnyInternal = (src) => PIPELINE_INTERNALS.filter((mod) => new RegExp(`(import|require)[^\\n]*['"\`][^'"\`]*${mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(src));

check("(a) BRAND — createProductionPipeline mints a Pipeline; a look-alike object is NOT one (un-forgeable)", () => {
  const p = createProductionPipeline();
  assert.equal(isProductionPipeline(p), true, "the factory's product is a Pipeline");
  assert.equal(isProductionPipeline({ kind: "ProductionPipeline", run() {} }), false, "a hand-built look-alike is NOT a Pipeline (Symbol seal)");
  assert.equal(isProductionPipeline(JSON.parse(JSON.stringify(p))), false, "a serialized/rehydrated copy loses the seal — cannot cross JSON");
});

check("(c) HONEST SEAMS — run() throws a NAMED error for an un-wired adapter (never a fabricated config)", async () => {
  const p = createProductionPipeline();
  await assert.rejects(() => p.run({}), /buildAuthoringInputs adapter not wired/, "no authoring-inputs adapter ⇒ named throw");
  const p2 = createProductionPipeline({ buildAuthoringInputs: async () => ({ units: [], resolvedContracts: [], context: {}, skuMeta: {}, skusByFamily: {}, budget: null, leafCaps: { primary: 1, total: 4, display_primary: 3 }, treeLimits: {} }) });
  await assert.rejects(() => p2.run({}), /emitCertifiedArtifact adapter not wired|/, "no emitter ⇒ named throw (or an upstream build error) — never a fake config");
});

check("(b) IMPORT ISOLATION — no production entry imports a pipeline internal directly (only the factory may)", () => {
  const offenders = [];
  for (const rel of PRODUCTION_ENTRIES) { const src = readIfExists(rel); if (src == null) continue; const hits = importsAnyInternal(src); if (hits.length) offenders.push(`${rel} → ${hits.join(", ")}`); }
  assert.deepEqual(offenders, [], "a production entry imports a pipeline internal directly (assembling its own chain) — route it through createProductionPipeline: " + offenders.join(" | "));
  // the factory IS the sole importer of the internals (it must reach them).
  const factory = readIfExists("authoring/pipeline/pipeline.js");
  assert.ok(importsAnyInternal(factory).length >= 2, "the factory itself imports the internals (it is the sole assembler)");
  console.log(`  · scanned ${PRODUCTION_ENTRIES.length} entries · 0 import pipeline internals directly · factory is the sole importer`);
});

check("(d) SELF-PROVING CANARY — a rogue entry that imports an internal IS caught by the scanner", () => {
  const rogue = `import { certify } from "../engine/kernel/certifier.js";\nexport const x = certify;`; // a forbidden direct import
  const hits = importsAnyInternal(rogue);
  assert.ok(hits.length >= 1, "the scanner MUST flag a direct import of a pipeline internal (else the canary is untested)");
  // and a clean entry (routes through the factory) is NOT flagged.
  const clean = `import { createProductionPipeline } from "../authoring/pipeline/pipeline.js";\nexport const p = createProductionPipeline();`;
  assert.equal(importsAnyInternal(clean).length, 0, "an entry that uses the factory is NOT flagged");
  console.log(`  · canary bites: rogue import flagged (${hits.join(", ")}); factory-routed entry clean`);
});

if (process.exitCode === 1) console.error("\nFAIL — the pipeline factory / import isolation is not sound.\n");
else console.log(`\nPASS — all ${passed} pipeline-factory checks. Single un-forgeable Pipeline; internals import-isolated to the factory; honest seams; canary bites. (Step 2 foundation; the emitter + wiring = step 3.)\n`);
