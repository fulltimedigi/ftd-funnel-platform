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

  // catalogMeta (family_id → real URL + descriptive attributes) — kept for the family-level display source.
  const catalogMeta = {};
  for (const f of familyMatrix) catalogMeta[f.family_id] = {
    url: f.url || null,
    attributes: { title: (f.text && f.text.title) || null, type: (f.structured && f.structured.product_type) || null },
  };

  // skuMeta (sku_id → the SHIPPED CATALOG SNAPSHOT of one VARIANT) — the ground truth for the SKU-LEVEL I3
  // witness (round-11). A grid CTA must resolve to a SPECIFIC sku here (its own buy_url + price), be present
  // in this snapshot, and satisfy the path's hard budget ceiling; a family url is NOT a per-variant CTA.
  const titleByFamily = {};
  for (const f of familyMatrix) titleByFamily[f.family_id] = (f.text && f.text.title) || null;
  const skuMeta = {};
  for (const s of skuMatrix) skuMeta[s.sku_id] = {
    family_id: s.family_id, price: s.price, buy_url: s.buy_url, availability: s.availability,
    attributes: { title: titleByFamily[s.family_id], option: s.option_values || {} },
  };
  // budget = the HARD purchase-ceiling axis (resolved thresholds + ordinal order) — from the SAME contract the
  // brain used, so the ceiling check is not a test literal.
  const budgetContract = resolvedContracts.find((c) => c.axis_id === "budget");
  const budget = budgetContract ? { axis: "budget", thresholds: budgetContract.resolved.thresholds, order: budgetContract.order } : null;

  // Leaf display caps + full-tree limits come from POLICY, never a test literal (4-b corrections 3 & ruling 4).
  const pol = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "config", "policy.json"), "utf8"));
  const leafCaps = { primary: pol.surface.leaf_primary_cap, total: pol.surface.leaf_total_cap, policy_version: pol.policy_version };
  // v9: the options cap is OWNED by the display contract (the brain reads it, never derives it).
  const treeLimits = { ...pol.authoring_tree, max_published_options_per_question: pol.display_contract.max_published_options_per_question, policy_version: pol.policy_version };

  const context = { structural_catalog_version: "oud_cat_1", policy_version: "oud_pol_1", kernel_version: "k_1" };
  return { units, resolvedContracts, context, skusByFamily, catalogMeta, skuMeta, budget, displayContract: pol.display_contract, thresholds, leafCaps, treeLimits, familyCount: familyMatrix.length, skuCount: skuMatrix.length };
}
