/**
 * authoring/pipeline/pipeline.js — THE SINGLE PRODUCTION PIPELINE (delivery step 2, ADR-0066).
 * ===========================================================================================
 * PREVENT, don't detect. The certified chain —
 *     catalog → (authoring inputs) → brain2 tree → structural compiler → kernel certifier → CertifiedArtifact
 * — can be assembled ONLY here. A `Pipeline` is minted by `createProductionPipeline()` alone, sealed with a
 * module-private Symbol (never exported, never serialized). Every entry point ACCEPTS a Pipeline (`isProductionPipeline`)
 * and cannot construct one, so "an entry assembles its own chain" is structurally UNREPRESENTABLE — not merely
 * flagged. The pipeline INTERNALS (brain2, the structural compiler, the kernel certifier) are imported ONLY by
 * this module; the import-isolation canary (`tests/pipeline.factory.test.mjs`) fails CI if any production entry
 * imports them directly.
 *
 * HONEST SEAMS (no silent stubs): `run` performs the REAL chain as far as its adapters allow and THROWS a named
 * error for any adapter not yet wired — it never fabricates a config. The two adapters the production chain still
 * needs (both live only in tests today) are declared here as required injected seams:
 *   • `buildAuthoringInputs(catalog, opts)` → { units, resolvedContracts, context, skuMeta, skusByFamily, budget, leafCaps, treeLimits }
 *   • `emitCertifiedArtifact({ tree, cinput, certResult, versions })` → the runtime CertifiedArtifact config
 * Until both are provided, `run` throws `pipeline: <seam> not wired` — a loud, named gap, never a fake success.
 */
import { AuthoringOracle } from "../../engine/kernel/authoringOracle/authoringOracle.js";
import { buildFullTree, RULE_V10 } from "../brain2/tree.js";
import { compileTree } from "../compiler/structuralCompiler.js";
import { certify, CERTIFIER_VERSION } from "../../engine/kernel/certifier.js";

// The pipeline's INTERNAL modules — the import-isolation canary asserts NO production entry imports these
// directly (only this factory may). Adding one to an entry ⇒ CI red.
export const PIPELINE_INTERNALS = Object.freeze([
  "brain2/",
  "compiler/structuralCompiler",
  "kernel/certifier",
]);

// brain identity carried onto the artifact (the contract's `brain_version`). brain2 = the P1 tree brain that
// feeds the structural compiler (NOT authoring/brain, the six-numbers tree — resolved in ADR-0066).
export const BRAIN_VERSION = "brain2-p1";

const PIPELINE_SEAL = Symbol("ftd.ProductionPipeline");

/**
 * The ONE constructor of a Pipeline. Deps are the injected adapters (kept injectable so the chain stays
 * offline-testable and the factory stays the sole assembler).
 * @param {{ buildAuthoringInputs?: Function, emitCertifiedArtifact?: Function, ruleId?: string }} deps
 */
export function createProductionPipeline(deps = {}) {
  const buildAuthoringInputs = deps.buildAuthoringInputs || null;
  const emitCertifiedArtifact = deps.emitCertifiedArtifact || null;

  async function run(catalog, opts = {}) {
    if (typeof buildAuthoringInputs !== "function") throw new Error("pipeline: buildAuthoringInputs adapter not wired (catalog → authoring inputs) — delivery step 3");
    // 1) catalog → authoring inputs (units/contracts/skuMeta/budget/limits) — the phase-A adapter.
    const inp = await buildAuthoringInputs(catalog, opts);
    // 2) brain2 tree (the P1 decision tree) — the ONLY tree the structural compiler consumes.
    const oracle = new AuthoringOracle({ units: inp.units, resolvedContracts: inp.resolvedContracts, context: inp.context });
    const tree = buildFullTree(oracle, { limits: { ...inp.treeLimits, leaf_primary_cap: inp.leafCaps.primary }, rule: RULE_V10 });
    // 3) structural compiler → CertificationInput (structure only; no matching, no proof).
    const cinput = compileTree(oracle, tree, {
      catalogVersion: inp.context.structural_catalog_version, policyVersion: inp.context.policy_version,
      kernelVersion: inp.context.kernel_version, leafPrimaryCap: inp.leafCaps.primary,
      displayPrimaryCap: inp.leafCaps.display_primary, leafTotalCap: inp.leafCaps.total,
    });
    // 4) kernel certifier → re-derive + mint (proofs, invariants, the size-picker grid).
    const kernelConstraints = inp.resolvedContracts.map((c) => ({ id: c.axis_id, type: c.type, mode: c.mode, priority: c.priority, order: c.order, resolved: c.resolved || null }));
    const certResult = certify(cinput, {
      units: inp.units, constraints: kernelConstraints, opts: {}, activeSkus: inp.skuCount || 0,
      skuMeta: inp.skuMeta, skusByFamily: inp.skusByFamily, budget: inp.budget,
      versions: { compiler_version: cinput.version, kernel_version: inp.context.kernel_version, policy_version: inp.context.policy_version, brain_version: BRAIN_VERSION, certifier_version: CERTIFIER_VERSION },
    });
    const versions = { brain_version: BRAIN_VERSION, compiler_version: cinput.version, kernel_version: inp.context.kernel_version, certifier_version: CERTIFIER_VERSION, policy_version: inp.context.policy_version };
    // 5) emit the runtime CertifiedArtifact config (the tree/certificate → questions/decisionTable-with-proofs
    //    adapter). A named, loud gap until step 3 wires it — never a fabricated config.
    if (typeof emitCertifiedArtifact !== "function") throw new Error("pipeline: emitCertifiedArtifact adapter not wired (tree/certificate → runtime CertifiedArtifact config) — delivery step 3");
    return emitCertifiedArtifact({ tree, cinput, certResult, versions, inputs: inp });
  }

  return Object.freeze({ [PIPELINE_SEAL]: true, kind: "ProductionPipeline", run });
}

/** The entry-point guard: only a Symbol-branded Pipeline (minted by createProductionPipeline) is accepted. */
export function isProductionPipeline(x) {
  return !!(x && typeof x === "object" && x[PIPELINE_SEAL] === true && typeof x.run === "function");
}

export default { createProductionPipeline, isProductionPipeline, PIPELINE_INTERNALS, BRAIN_VERSION };
