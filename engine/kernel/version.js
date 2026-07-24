/**
 * engine/kernel/version.js — deterministic catalog + policy versioning (ADR-0037, Guardrail G2).
 * ---------------------------------------------------------------------------------------------
 * Every SelectionResult carries `catalog_version` and `policy_version`. They are content hashes,
 * so the runtime verifier can tell — cheaply, deterministically, with no clock or randomness —
 * whether the SKU it is about to render still belongs to the catalog the funnel was compiled
 * against, and whether the matching policy is the one that authored it. A mismatch means STALE:
 * re-run the kernel or refuse to render (never render a stale never-relax break).
 *
 * FNV-1a 32-bit — dependency-free, stable across Node and the browser, order-sensitive.
 */

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

/** Stable identity of a product on the axes that matter to matching (url + price + grounded values). */
export function catalogVersion(products) {
  const rows = (products || [])
    .map((p) => `${p.url}|${p.price ?? ""}|${(p.attributes && p.attributes.type) || ""}|${(p.differentiators || []).join(",")}`)
    .sort();
  return "cat_" + fnv1a(rows.join("\n")) + "." + rows.length;
}

/** Stable identity of the matching policy: the typed constraints and their modes/priorities. */
export function policyVersion(constraints) {
  const rows = (constraints || [])
    .map((c) => `${c.id}:${c.type}:${c.mode}:${c.priority || 0}:${(c.order || []).join(">")}`)
    .sort();
  return "pol_" + fnv1a(rows.join("\n"));
}

/**
 * Stable identity of the NAMED ANSWER CONTRACT (ADR-0037 closing, VERSION COHERENCE): the exact
 * set of questions, options, and the value each option compiles to that the shopper answered
 * against. If the questions or an option→value mapping change, the contract changes — a proof
 * minted against the old contract must not be shown against the new one.
 */
export function answerContractVersion(signals, questions) {
  const opt = new Map();
  for (const q of questions || []) for (const o of q.options || []) opt.set(o.id, o.label);
  const rows = (signals || [])
    .map((s) => `${s.id}|${(s.domain || []).join(",")}|${Object.entries(s.map || {}).sort().map(([oid, v]) => `${oid}=>${v}:${opt.get(oid) || ""}`).join(";")}`)
    .sort();
  return "ans_" + fnv1a(rows.join("\n"));
}

/** Version of the shopper-facing locale bundle (labels/copy) — a translation swap is a new bundle. */
export function localeBundleVersion(config) {
  const lang = config.lang || "";
  const strings = [];
  for (const q of config.questions || []) { strings.push(q.text || ""); for (const o of q.options || []) strings.push(o.label || ""); }
  for (const a of config.archetypes || []) strings.push(a.name || "");
  return "loc_" + lang + "_" + fnv1a(strings.join(""));
}

/** One coherence stamp covering the whole decision-relevant config (the "config_hash"). */
export function configHash(config) {
  const decisive = JSON.stringify({
    id: config.id, ladder: config.constraintLadder, policy: config.constraintPolicy,
    table: (config.decisionTable || []).map((r) => [r.id, r.when, r.result, r.unreachable || false]),
    cat: config.catalog_version, pol: config.policy_version, ans: config.answer_contract_version,
  });
  return "cfg_" + fnv1a(decisive);
}

export default { catalogVersion, policyVersion, answerContractVersion, localeBundleVersion, configHash };
