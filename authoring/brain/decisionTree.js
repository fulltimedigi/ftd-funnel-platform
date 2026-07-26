/**
 * authoring/brain/decisionTree.js — Part-2 brain, BUILD STEP 5: state-aware decision tree.
 * ---------------------------------------------------------------------------------------------
 * Compiles the published, roled axes into a deterministic decision tree (zero runtime LLM). Question
 * order follows axis_role: hard (type) → budget_ceiling (price, inclusive ≤ ceiling) → fit (origin,
 * only in branches where it is published, with a MANDATORY "any" option so unknown-origin products stay
 * reachable). Invariants enforced by construction:
 *   • Exact-support — an option is emitted only if ≥1 real product survives the path so far (no dead option).
 *   • No empty branch — an option with zero candidates is never created.
 *   • Every leaf's products satisfy every constraint on its path.
 * Oversized leaves (> leafCap) are NOT pruned and NOTHING is hidden (ق20): they become an honest
 * comparison grid — declared ordering + per-item tie_break_reason + scent notes shown on each card
 * (scent is axis_role=descriptive: display/explain only, never a question — ق13). Pure & deterministic.
 */

const NOTES = ["rose","tobacco","saffron","musk","oud","agarwood","incense","leather","amber","vanilla",
  "patchouli","tuberose","floral","citrus","grapefruit","spice","spicy","sweet","smoky","smoke","woody",
  "cardamom","peony","sandalwood","jasmine","coffee","cacao","chocolate","honey","fruity","aquatic","ocean","marine"];
const strip = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
function scentNotes(desc) { const d = strip(desc).toLowerCase(); return [...new Set(NOTES.filter((n) => new RegExp(`\\b${n}\\b`, "i").test(d)))]; }

const BANDS = ["low", "mid", "high"];

export function buildDecisionTree(axes = [], familyMatrix = [], skuMatrix = [], opts = {}) {
  const primaryCap = opts.primaryCap ?? 3, leafCap = opts.leafCap ?? 5;
  const typeAxis = axes.find((a) => a.axis_key === "type");
  const priceAxis = axes.find((a) => a.axis_key === "price");
  const originAxis = axes.find((a) => a.axis_key === "origin");
  const bandIdx = (v) => BANDS.indexOf(v);
  const ceilings = (priceAxis && priceAxis.boundaries && priceAxis.boundaries.ceilings) || [Infinity, Infinity, Infinity];

  const skusByFam = new Map();
  for (const s of skuMatrix) { if (!skusByFam.has(s.family_id)) skusByFam.set(s.family_id, []); skusByFam.get(s.family_id).push(s); }
  const famType = new Map(), famBand = new Map(), famOrigin = new Map(), famNotes = new Map(), famMinPrice = new Map(), famOfferSku = new Map();
  for (const f of familyMatrix) {
    famType.set(f.family_id, (f.structured && f.structured.product_type) || "(none)");
    famNotes.set(f.family_id, scentNotes((f.text && f.text.description) || ""));
    const skus = (skusByFam.get(f.family_id) || []).filter((s) => s.price != null);
    // budget matching is VARIANT-level (defect #6 guard): the OFFERED variant is the cheapest purchasable
    // one — a family qualifies for a budget band by this variant, and the leaf shows THIS variant, not the family.
    const cheapest = skus.slice().sort((a, b) => a.price - b.price)[0] || null;
    famMinPrice.set(f.family_id, cheapest ? cheapest.price : null);
    famOfferSku.set(f.family_id, cheapest ? cheapest.sku_id : null);
  }
  if (priceAxis) for (const v of priceAxis.values) for (const fid of v.families) famBand.set(fid, v.value);
  if (originAxis) for (const v of originAxis.values) for (const fid of v.families) famOrigin.set(fid, v.value);
  const originBranchValues = (originAxis && originAxis.applicability && originAxis.applicability.branch_values) || {};

  const allFamilies = familyMatrix.map((f) => f.family_id);

  function leaf(cands, path) {
    const ranked = cands.slice().sort((a, b) => (famMinPrice.get(a) ?? Infinity) - (famMinPrice.get(b) ?? Infinity) || String(a).localeCompare(String(b)));
    const oversized = ranked.length > leafCap;
    return {
      kind: "leaf", path, count: ranked.length, oversized,
      ceiling_price: path.ceiling != null ? ceilings[path.ceiling] : Infinity,
      display: oversized ? "comparison_grid" : (ranked.length > primaryCap ? "primary_plus_alternatives" : "decisive"),
      primary: ranked.slice(0, primaryCap),
      items: ranked.map((fid) => ({
        family: fid, price: famMinPrice.get(fid), offered_variant: { sku_id: famOfferSku.get(fid), price: famMinPrice.get(fid) }, notes: famNotes.get(fid) || [],
        tie_break_reason: `price ${famMinPrice.get(fid)} AED · character: ${(famNotes.get(fid) || []).slice(0, 3).join("/") || "—"}`,
      })),
      note: oversized ? "هذه كلها تحقق اختيارك؛ الفرق بينها في الطابع" : null,
      skus: ranked.flatMap((fid) => (skusByFam.get(fid) || []).map((s) => s.sku_id)),
    };
  }

  function build(cands, stage, path) {
    if (stage === 0) {
      const options = [];
      for (const v of (typeAxis ? typeAxis.values : [])) {
        const c = cands.filter((fid) => famType.get(fid) === v.value);
        if (c.length) options.push({ value: v.value, child: build(c, 1, { ...path, type: v.value }) }); // Exact-support: only nonempty
      }
      return { kind: "question", axis: "type", role: "hard", options };
    }
    if (stage === 1) {
      const options = [];
      for (let k = 0; k < BANDS.length; k++) {
        const c = cands.filter((fid) => { const bi = bandIdx(famBand.get(fid)); return bi >= 0 && bi <= k; }); // ceiling = inclusive ≤
        if (c.length) options.push({ value: BANDS[k], ceiling: true, child: build(c, 2, { ...path, ceiling: k }) });
      }
      return { kind: "question", axis: "price", role: "budget_ceiling", options };
    }
    if (stage === 2) {
      const published = originBranchValues[path.type] || [];
      if (!published.length) return leaf(cands, path); // origin not a question in this branch
      const options = [];
      for (const val of published) {
        const c = cands.filter((fid) => famOrigin.get(fid) === val);
        if (c.length) options.push({ value: val, child: leaf(c, { ...path, origin: val }) }); // Exact-support
      }
      options.push({ value: "any", mandatory: true, child: leaf(cands, { ...path, origin: "any" }) }); // ق2: unknown stays reachable
      return { kind: "question", axis: "origin", role: "fit", options };
    }
    return leaf(cands, path);
  }

  const tree = build(allFamilies, 0, {});
  const leaves = [];
  (function walk(n) { if (n.kind === "leaf") leaves.push(n); else for (const o of n.options) walk(o.child); })(tree);
  return {
    tree, leaves,
    oversized_leaf_count: leaves.filter((l) => l.oversized).length,
    biggest_leaf: leaves.reduce((m, l) => Math.max(m, l.count), 0),
  };
}

/** Deterministic traversal: returns a leaf ONLY for a fully-valid answer path; an invalid/partial answer
 *  yields the current question or {no_result:true} — never a fabricated result (structural fuzz guard). */
export function traverse(tree, answers = {}) {
  let node = tree, steps = 0;
  while (node && node.kind === "question") {
    if (steps++ > 8) return { no_result: true, reason: "cycle-guard" };
    const a = answers[node.axis];
    const opt = (node.options || []).find((o) => o.value === a);
    if (a === undefined) return { pending: node.axis, question: node };   // partial → no result, ask next
    if (!opt) return { no_result: true, reason: `invalid answer for ${node.axis}: ${a}` }; // corrupted → no fabrication
    node = opt.child;
  }
  return node && node.kind === "leaf" ? { leaf: node } : { no_result: true };
}
