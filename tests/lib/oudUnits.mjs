/**
 * tests/lib/oudUnits.mjs — derive oracle inputs from the REAL oudfactory catalog (server/phase-A side).
 * Families → units {type, budget-band}; a nominal `type` axis (the one-level tree axis) + an ordinal
 * `budget` axis carrying RESOLVED price thresholds (to exercise the C2 hash-completeness correction).
 * This is phase-A work (it touches the catalog); phase B (the tree builder) never sees any of it.
 */
import { oudfactory } from "./realCatalog.mjs";

function bandOf(price, [t1, t2]) {
  if (price == null || !Number.isFinite(price)) return null;
  return price <= t1 ? "low" : price <= t2 ? "mid" : "high";
}

/** @param {[number,number]} [thresholdsOverride] — pass to perturb a contract threshold (hash test). */
export async function oudOneLevelInputs(thresholdsOverride) {
  const { familyMatrix, skuMatrix } = await oudfactory();

  const minPrice = (f) => { const ps = (f.prices || []).filter(Number.isFinite); return ps.length ? Math.min(...ps) : null; };
  const sortedMins = familyMatrix.map(minPrice).filter((p) => p != null).sort((a, b) => a - b);
  const t1 = sortedMins[Math.floor(sortedMins.length / 3)] ?? 0;
  const t2 = sortedMins[Math.floor((2 * sortedMins.length) / 3)] ?? 0;
  const thresholds = thresholdsOverride || [t1, t2];

  const units = familyMatrix.map((f) => {
    const type = (f.structured && f.structured.product_type) || null;
    const p = minPrice(f);
    return {
      id: f.family_id,
      values: {
        type: type ? { value: type, grounded: true } : { value: null, grounded: false },
        budget: p != null ? { value: bandOf(p, thresholds), grounded: true } : { value: null, grounded: false },
      },
    };
  });

  const resolvedContracts = [
    { axis_id: "type", type: "nominal", mode: "NEVER_RELAX", priority: 1 },
    { axis_id: "budget", type: "ordinal", mode: "RELAXABLE", priority: 2, order: ["low", "mid", "high"], resolved: { thresholds } },
  ];

  const skusByFamily = {};
  for (const s of skuMatrix) (skusByFamily[s.family_id] ||= []).push(s.sku_id);

  const context = { structural_catalog_version: "oud_cat_1", policy_version: "oud_pol_1", kernel_version: "k_1" };
  return { units, resolvedContracts, context, skusByFamily, thresholds, familyCount: familyMatrix.length, skuCount: skuMatrix.length };
}
