/**
 * tests/lib/oudUnits.mjs — derive oracle inputs from the REAL oudfactory catalog (server/phase-A side).
 * Families → units {type, budget-band}; a nominal `type` axis (the one-level tree axis) + an ordinal
 * `budget` axis carrying RESOLVED price thresholds (to exercise the C2 hash-completeness correction).
 * This is phase-A work (it touches the catalog); phase B (the tree builder) never sees any of it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { oudfactory } from "./realCatalog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function bandOf(price, [t1, t2]) {
  if (price == null || !Number.isFinite(price)) return null;
  return price <= t1 ? "low" : price <= t2 ? "mid" : "high";
}

// origin (3rd axis) — DERIVED from the family's own text (not fabricated): a keyword scan of title+desc.
const ORIGINS = ["indian", "borneo", "kalimantan", "malaysian", "cambodi", "silani", "hindi"];
function originOf(f) {
  const hay = ((f.text && (f.text.title + " " + f.text.description)) || "").toLowerCase();
  for (const o of ORIGINS) if (hay.includes(o)) return o === "hindi" ? "indian" : o;
  return null; // no origin keyword → ungrounded (a soft/relaxable axis, so it never rejects)
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
    const origin = originOf(f);
    return {
      id: f.family_id,
      values: {
        type: type ? { value: type, grounded: true } : { value: null, grounded: false },
        budget: p != null ? { value: bandOf(p, thresholds), grounded: true } : { value: null, grounded: false },
        origin: origin ? { value: origin, grounded: true } : { value: null, grounded: false },
      },
    };
  });

  const resolvedContracts = [
    { axis_id: "type", type: "nominal", mode: "NEVER_RELAX", priority: 1 },
    { axis_id: "budget", type: "ordinal", mode: "RELAXABLE", priority: 2, order: ["low", "mid", "high"], resolved: { thresholds } },
    // origin is a SOFT (RELAXABLE) nominal fit-axis: a mismatch/unknown is a COMPROMISE (eligible), never a
    // rejection — so it never buries a family, and it exercises the compromise-leaf publish rule (level 3).
    { axis_id: "origin", type: "nominal", mode: "RELAXABLE", priority: 3 },
  ];

  const skusByFamily = {};
  for (const s of skuMatrix) (skusByFamily[s.family_id] ||= []).push(s.sku_id);

  // Leaf display caps come from POLICY, never a test literal (4-b correction 3).
  const pol = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "config", "policy.json"), "utf8"));
  const leafCaps = { primary: pol.surface.leaf_primary_cap, total: pol.surface.leaf_total_cap, policy_version: pol.policy_version };

  const context = { structural_catalog_version: "oud_cat_1", policy_version: "oud_pol_1", kernel_version: "k_1" };
  return { units, resolvedContracts, context, skusByFamily, thresholds, leafCaps, familyCount: familyMatrix.length, skuCount: skuMatrix.length };
}
