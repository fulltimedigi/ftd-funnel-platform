/**
 * authoring/brain2/cleanRoom.js — STEP 4-a0: the CLEAN ROOM (ADR-0045, contract §4-a0).
 * -------------------------------------------------------------------------------------------------
 * The new brain is rebuilt from scratch under a NEW namespace (`authoring/brain2/`) so it cannot inherit
 * the old matcher's contamination — not through imports, and not through DATA. This module is the input
 * boundary: an ALLOWLIST (not a denylist) of primary sources, plus a data-level forbidden-lineage scan.
 *
 * ALLOWED (primary sources, re-derived — never migrated outputs):
 *   raw_catalog_snapshot · sku_ledger · verified_evidence_links · signed_merchant_exclusions ·
 *   current_policy · frozen_gold
 * FORBIDDEN (legacy brain OUTPUTS, in kind OR smuggled as data):
 *   profiles · archetypes · candidate sets · old axis order · scores/thresholds (exactPathTarget…) ·
 *   leaves · decisionTable · proofs · caches · any fixture derived from the old brain's output.
 *
 * FAIL-CLOSED: an empty input set is NOT a clean room; an unknown kind is refused; any allowed-kind
 * input whose CONTENT carries legacy-matcher lineage is refused. Every accepted input is hashed into an
 * InputManifest (provenance). `frozen_gold` is reviewed TRUTH (human-signed), so it is exempt from the
 * lineage scan (its expected labels are truth, not a legacy computation) but still hashed + kind-checked.
 */
import { createHash } from "node:crypto";

export const ALLOWED_INPUT_KINDS = new Set([
  "raw_catalog_snapshot", "sku_ledger", "verified_evidence_links",
  "signed_merchant_exclusions", "current_policy", "frozen_gold",
]);

// Data-level lineage of a legacy MATCHER/BRAIN OUTPUT — scanned in CONTENT (a smuggled leaf/table/profile
// is contamination even if no module is imported). `frozen_gold` truth labels are exempt (see below).
export const FORBIDDEN_LINEAGE_KEYS = [
  "decisionTable", "archetypes", "profiles", "leaves", "leaf", "exactPath", "exactPathTarget",
  "candidatePool", "candidates", "match_state", "structural_match_state", "scores", "proof", "proofs", "winner",
];

/** Deep-scan a value for forbidden lineage KEYS (data-level, not imports). Returns hit paths ([] = clean). */
export function forbiddenLineageHits(value) {
  const hits = [];
  (function walk(v, path) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_LINEAGE_KEYS.includes(k)) hits.push(path ? `${path}.${k}` : k);
      walk(v[k], path ? `${path}.${k}` : k);
    }
  })(value, "");
  return hits;
}

function hashContent(content) {
  const s = typeof content === "string" ? content : JSON.stringify(content);
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/**
 * Build an InputManifest, FAIL-CLOSED. @param sources [{ name, kind, content }]
 * @returns [{ name, kind, hash }] · throws on empty set / forbidden kind / smuggled legacy lineage.
 */
export function buildInputManifest(sources = []) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("cleanRoom: an empty input set is not a clean room — provide the allowed primary sources (fail-closed)");
  }
  const manifest = [];
  for (const src of sources) {
    if (!src || !src.name || !src.kind) throw new Error("cleanRoom: each input needs { name, kind, content }");
    if (!ALLOWED_INPUT_KINDS.has(src.kind)) {
      throw new Error(`cleanRoom: FORBIDDEN input kind "${src.kind}" (${src.name}) — the clean room accepts only primary sources, never legacy brain outputs`);
    }
    if (src.kind !== "frozen_gold") { // gold is reviewed TRUTH, exempt from the legacy-output scan
      const hits = forbiddenLineageHits(src.content);
      if (hits.length) throw new Error(`cleanRoom: input "${src.name}" carries LEGACY-MATCHER lineage in its data: ${hits.slice(0, 5).join(", ")}`);
    }
    manifest.push({ name: src.name, kind: src.kind, hash: hashContent(src.content) });
  }
  return manifest;
}

export default { ALLOWED_INPUT_KINDS, FORBIDDEN_LINEAGE_KEYS, forbiddenLineageHits, buildInputManifest };
