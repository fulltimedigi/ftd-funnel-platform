/**
 * engine/kernel/authoringOracle/differential.js — RUNTIME MEMBERSHIP DIFFERENTIAL (ADR-0046).
 * ===========================================================================================
 * The certified pool (what the kernel admitted at authoring time) and the runtime pool (what the
 * served artifact actually offers) MUST have identical membership. A non-empty differential means a
 * SKU leaked in — or dropped out — between authoring and runtime: a poison canary that must bite,
 * never a silent divergence. Pure, deterministic, browser-safe (the browser runs this on load to
 * re-verify the CertifiedArtifact against the kernel-derived pool).
 */

export function runtimeMembershipDifferential(certifiedMembers, runtimeMembers) {
  const cert = new Set((certifiedMembers || []).map(String));
  const run = new Set((runtimeMembers || []).map(String));
  const onlyInCertified = [...cert].filter((x) => !run.has(x)).sort();
  const onlyInRuntime = [...run].filter((x) => !cert.has(x)).sort();
  return Object.freeze({
    equal: onlyInCertified.length === 0 && onlyInRuntime.length === 0,
    onlyInCertified: Object.freeze(onlyInCertified),
    onlyInRuntime: Object.freeze(onlyInRuntime),
  });
}

export default { runtimeMembershipDifferential };
