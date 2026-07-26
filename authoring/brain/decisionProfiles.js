/**
 * authoring/brain/decisionProfiles.js — Part-2 brain, BUILD STEP 4: decision profiles + conservative fold.
 * ---------------------------------------------------------------------------------------------
 * Third ledger level (Family → Decision Profile → SKU). A profile groups families the funnel's PUBLISHED
 * axes cannot tell apart. Fold rule (conservative): two families fold ⇔ no published value on ANY axis
 * distinguishes them — when in doubt (unknown vs a value) they do NOT fold. Hard guards, on top of the
 * signature: a fold never crosses a published price band (ق4) and never mixes a bundle with a single
 * product. The signature is exactly the tuple of published-axis values, so the guards hold by construction
 * (band and type are part of the signature); the bundle flag makes the single/bundle split explicit.
 * Pure, deterministic. Folding does not touch axis contracts, so the ceiling is unchanged — the caller
 * (test) re-proves it after folding as a defensive gate.
 */

const BUNDLE = /\b(box|set|bundle|kit|collection)\b/i;

export function buildDecisionProfiles(axes = [], familyMatrix = [], skuMatrix = []) {
  const typeOf = new Map(familyMatrix.map((f) => [f.family_id, (f.structured && f.structured.product_type) || "(none)"]));
  const isBundle = new Map(familyMatrix.map((f) => [f.family_id, BUNDLE.test((f.text && f.text.title) || "")]));

  // published-axis value lookups (missing ⇒ "unknown", which never folds with a real value)
  const bandOf = new Map();
  const priceAxis = axes.find((a) => a.axis_key === "price");
  if (priceAxis) for (const v of priceAxis.values) for (const fid of v.families) bandOf.set(fid, v.value);
  const originOf = new Map();
  const originAxis = axes.find((a) => a.axis_key === "origin");
  if (originAxis) for (const v of originAxis.values) for (const fid of v.families) originOf.set(fid, v.value);

  // signature = the distinguishing published values; bundle flag keeps bundles and singles apart.
  const signature = (fid) =>
    `${isBundle.get(fid) ? "bundle" : "single"}|type=${typeOf.get(fid) || "?"}|band=${bandOf.get(fid) || "unknown"}|origin=${originOf.get(fid) || "unknown"}`;

  const groups = new Map();
  for (const f of familyMatrix) {
    const sig = signature(f.family_id);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(f.family_id);
  }

  const profiles = [...groups.entries()].map(([sig, families], i) => ({ profile_id: "P" + i, families, fold_basis: sig }));
  const folds = profiles.filter((p) => p.families.length > 1);
  return { profiles, folds, before: familyMatrix.length, after: profiles.length };
}
