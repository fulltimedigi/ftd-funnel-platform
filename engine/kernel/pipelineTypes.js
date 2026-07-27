/**
 * engine/kernel/pipelineTypes.js — the certified-pipeline TYPE boundaries (ADR-0044, contract §3).
 * -------------------------------------------------------------------------------------------------
 * AuthoringIR → CertificationInput → CertifiedArtifact. The load-bearing guarantees are STRUCTURAL:
 *   1. No pre-certification type may carry a selection result / proof (structure only).  [assertNoSelection]
 *   2. A persisted artifact's `artifact_kind` field is UNTRUSTED — a plain file can write
 *      {"artifact_kind":"CERTIFIED_ARTIFACT"}. So on load we RE-VERIFY through the kernel and accept
 *      ONLY if it passes. This is the direct fix for the recurring threat "WE produced an artifact that
 *      CLAIMS certified without ever passing the kernel" (it has recurred five times in this project).
 *      [loadCertifiedArtifact]
 * The CertifiedArtifact minting constructor lives ONLY in the kernel certifier (wired when the
 * structural compiler + kernel certifier land — step 4); this module is the type contract + the
 * fail-closed load boundary that protects it across JSON serialization.
 */
import { verifyFunnel } from "./verifyFunnel.js";

export const CERTIFIED_ARTIFACT_KIND = "CERTIFIED_ARTIFACT";

// Fields that betray a SELECTION RESULT — forbidden anywhere in AuthoringIR / CertificationInput (§3).
const SELECTION_FIELDS = new Set([
  "exact_candidates", "matched_skus", "match_state", "structural_match_state",
  "scores", "score", "proof", "proofs", "winner", "selected_sku", "chosen", "candidates",
]);

/** Assert a pre-certification object carries NO selection/proof — only structure (questions, options,
 *  axis_refs, constraint_refs, tree, terminal_policy_refs). Throws on any selection field. */
export function assertNoSelection(obj, where = "AuthoringIR") {
  const hits = [];
  (function walk(o, path) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    for (const k of Object.keys(o)) {
      if (SELECTION_FIELDS.has(k)) hits.push(path ? `${path}.${k}` : k);
      walk(o[k], path ? `${path}.${k}` : k);
    }
  })(obj, "");
  if (hits.length) throw new Error(`${where}: a pre-certification type carries selection field(s) — contract §3 forbids a matcher before the kernel: ${hits.slice(0, 6).join(", ")}`);
  return obj;
}

/**
 * Load a persisted artifact across the JSON boundary, FAIL-CLOSED. `artifact_kind` is NOT trusted —
 * the artifact is re-verified through the kernel (verifyFunnel) and accepted only if the report passes.
 * @returns {{ ok:true, artifact_kind, report, config }}  · throws on a forgery / unverifiable artifact.
 */
export function loadCertifiedArtifact(json, catalog) {
  let art;
  try { art = typeof json === "string" ? JSON.parse(json) : json; }
  catch (e) { throw new Error("loadCertifiedArtifact: unparseable artifact JSON — " + e.message); }
  const config = (art && art.config) || art;
  // Do NOT branch on art.artifact_kind — re-derive trust from the kernel, from scratch.
  const v = verifyFunnel(config, catalog || { products: [] });
  if (!v.ok) {
    const why = (v.report && v.report.failures ? v.report.failures.map((f) => f.msg).slice(0, 3).join("; ") : "")
      || `expected_count=${v.report && v.report.expected_count}, checked=${v.report && v.report.checked_count}`;
    throw new Error(`loadCertifiedArtifact: REJECTED — the artifact does NOT pass kernel re-verification (artifact_kind claim is untrusted): ${why}`);
  }
  return { ok: true, artifact_kind: CERTIFIED_ARTIFACT_KIND, report: v.report, config };
}

export default { CERTIFIED_ARTIFACT_KIND, assertNoSelection, loadCertifiedArtifact };
