# ADR-0066 — The single production pipeline factory (delivery step 2) + the wiring plan

- **Status:** Accepted. Step 2 built + proven (red-first). Steps 3–6 are the named, verified increments below —
  **not yet done** (honestly). Pull / SSRF untouched. Gold frozen.
- **Date:** 2026-07-28
- **Related:** `authoring/pipeline/pipeline.js`, `engine/kernel/pipelineTypes.js`, `tests/pipeline.factory.test.mjs`,
  `tests/contract.pipeline.e2e.test.mjs` (the red contract), `docs/standards/certified-pipeline-contract.md`,
  consultation round-12 (delivery).

## The map (confirmed before wiring)
- **Single chokepoint:** all three production entries (HTTP submit → background job, and the CLI) funnel through
  `authoring/index.js::generateFunnelFromUrl`, which today runs the **Stage-2 old brain** (`authoring/author/*`
  `authorFunnel` + `qualityGate.antiBlandCheck`) and emits a plain config carrying **none** of the certified stamps.
- **The P1 chain is test-only:** `authoring/brain2/*`, `authoring/compiler/structuralCompiler.js`, and
  `engine/kernel/certifier.js` are imported **only by tests** — the "a unit only tests import = incomplete build"
  state the contract forbids. Wiring them into production is this delivery.
- **The red contract** (`tests/contract.pipeline.e2e.test.mjs`) drives the real entry and demands
  `artifact_kind=CERTIFIED_ARTIFACT · compiler_version · kernel_version · brain_version · path_certified`.
- **Two brains (resolved):** `authoring/brain` (the tree the in-process six-numbers harness measures) vs
  `authoring/brain2` (the tree the structural compiler consumes). **Decision:** production wires **brain2** (the
  compiler/certifier chain is the certified path); the six-numbers are re-measured **through production over HTTP**
  (step 6) on brain2's served output — NOT on the in-process `brain` harness. So `brain_version = brain2-p1`.
- **Two adapters live only in tests** and must become production code: catalog→authoring-inputs (today in
  `tests/lib/oudUnits.mjs`) and tree/certificate→runtime-config (the emitter). These are the bulk of step 3.

## Decision — step 2: the single pipeline factory (PREVENT, don't detect)
`authoring/pipeline/pipeline.js` — `createProductionPipeline()` is the **only** constructor of a `Pipeline`, a
Symbol-sealed type (`PIPELINE_SEAL`, never exported/serialized). Entries accept a Pipeline (`isProductionPipeline`)
and cannot assemble one, so "an entry builds its own chain" is **structurally unrepresentable**. The pipeline
INTERNALS (`brain2/`, `compiler/structuralCompiler`, `kernel/certifier`) are imported **only** by the factory; the
import-isolation canary scans the five production entries and fails CI if any imports an internal directly, with a
**self-proving** rogue-import check (a scanner that never saw its own failure is not a check). `run()` executes the
real chain as far as its adapters allow and **throws a named error** for any un-wired adapter — never a fabricated
config (honest seams).

## Result (red-first — `tests/pipeline.factory.test.mjs`, 4 checks, in `npm test`)
- Brand: the factory's product is a Pipeline; a hand-built look-alike and a JSON round-trip are **not** (un-forgeable).
- Import isolation: 0 of 5 production entries import a pipeline internal directly; the factory is the sole importer.
- Honest seams: `run()` throws `buildAuthoringInputs/emitCertifiedArtifact not wired` — no fake config.
- Canary bites: a rogue direct import is flagged; a factory-routed entry is clean.

## The verified-increment plan (steps 3–6 — each red-first, each committed only when green)
3. **Emitter + wiring (turns the red contract GREEN):** build `buildAuthoringInputs(catalog)` (productionize the
   oudUnits adapter) and `emitCertifiedArtifact({tree, cinput, certResult})` → the runtime config
   (questions/signals/derivedSignals/decisionTable with a **kernel-minted proof per COMMERCE rule** + stamps).
   Route `generateFunnelFromUrl` through `createProductionPipeline`. Proof of done: `contract.pipeline.e2e` green.
4. **No-return (three layers):** (a) the old-brain module **throws on load** in a production build (not under the
   legacy author tests that still import it); (b) a static import-manifest check; (c) a canary that reddens CI.
5. **Service-path trace:** every request carries `brain_version·compiler_version·kernel_version·artifact_kind·
   path_certified`; a claim is accepted only with a **service-path** trace.
6. **Re-measure over HTTP:** a booted server; the corpus replayed **over HTTP only**; a harness with **no import
   privilege**; the six numbers move to the brain numbers, each backed by a trace.

## Consequences
- The certified chain now has its single, un-forgeable assembler; wiring proceeds against real seams, not assumed
  ones. Nothing in steps 3–6 is claimed done until its named proof is green.
- Not touched: axis-selection rule (frozen), gold, kernel, **pull/SSRF**. Gold frozen (`gold-1.0.0`, sha OK);
  nothing softened.
