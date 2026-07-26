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

  // ق20 d* MODES — build ONLY the axes actually published (never a hardcoded type→price→origin that
  // degenerates into a 0-option question when a store has a single product_type or no usable axis).
  // d* = number of question-axes the visitor faces → d*≥2 quiz · d*=1 single selector · d*=0 grid/recommendation-light.
  const hasType = !!typeAxis, hasPrice = !!priceAxis, hasOrigin = Object.keys(originBranchValues).length > 0;
  const plan = []; if (hasType) plan.push("type"); if (hasPrice) plan.push("price");
  const dStar = plan.length + (hasType && hasOrigin ? 1 : 0);

  function stepType(cands, planIdx, path) {
    const options = [];
    for (const v of typeAxis.values) { const c = cands.filter((fid) => famType.get(fid) === v.value); if (c.length) options.push({ value: v.value, child: build(c, planIdx + 1, { ...path, type: v.value }) }); }
    return { kind: "question", axis: "type", role: "hard", options };
  }
  function stepPrice(cands, planIdx, path) {
    const options = [];
    for (let k = 0; k < BANDS.length; k++) { const c = cands.filter((fid) => { const bi = bandIdx(famBand.get(fid)); return bi >= 0 && bi <= k; }); if (c.length) options.push({ value: BANDS[k], ceiling: true, child: build(c, planIdx + 1, { ...path, ceiling: k }) }); }
    return { kind: "question", axis: "price", role: "budget_ceiling", options };
  }
  function stepOrigin(cands, path) { // branch-conditional; only a question where the branch publishes origin
    const published = (hasType && originBranchValues[path.type]) || [];
    if (!published.length) return leaf(cands, path);
    const options = [];
    for (const val of published) { const c = cands.filter((fid) => famOrigin.get(fid) === val); if (c.length) options.push({ value: val, child: leaf(c, { ...path, origin: val }) }); }
    options.push({ value: "any", mandatory: true, child: leaf(cands, { ...path, origin: "any" }) }); // ق2: unknown stays reachable
    return { kind: "question", axis: "origin", role: "fit", options };
  }
  function build(cands, planIdx, path) {
    const step = plan[planIdx];
    if (step === "type") return stepType(cands, planIdx, path);
    if (step === "price") return stepPrice(cands, planIdx, path);
    return stepOrigin(cands, path); // plan exhausted → origin (or leaf)
  }

  // NO-PRICE POLICY (ق14 analogue): a family with no purchasable-priced variant never satisfies a budget
  // band and carries no active buy CTA. It is NOT silently dropped — it is ACCOUNTED in `price_unknown`
  // (counted + reported; a real product line would go tagged "price on request" or to the merchant queue).
  const priced = allFamilies.filter((fid) => famMinPrice.get(fid) != null);
  const noPrice = allFamilies.filter((fid) => famMinPrice.get(fid) == null);
  const priceUnknownSkus = noPrice.flatMap((fid) => (skusByFam.get(fid) || []).map((s) => s.sku_id));

  // route by d*: 0 → grid / recommendation-light (no question, one honest leaf); 1 → single selector; ≥2 → quiz.
  const mode = dStar === 0 ? "recommendation_light" : dStar === 1 ? "selector" : "quiz";
  const tree = dStar === 0
    ? leaf(priced, {}) // ق16: no valid axis ⇒ direct honest display; the oversized-leaf policy still applies
    : build(priced, 0, {});
  if (dStar === 0) { // recommendation-light: no question — explicit honest text to the shopper
    tree.note = tree.note || "هذه كل المنتجات المتاحة — لا يوجد محور يميّزها، اعرضها مباشرة";
    if (tree.display !== "comparison_grid") tree.display = "recommendation_light";
  }
  const leaves = [];
  (function walk(n) { if (n.kind === "leaf") leaves.push(n); else for (const o of n.options) walk(o.child); })(tree);

  // COVERAGE SWEEP (ق2, no silent drop): any priced family that still reached no leaf — e.g. an empty/junk
  // product_type that matched no published type branch — is ACCOUNTED as unroutable (→ merchant queue),
  // never silently dropped. Legit stores route everything, so this is empty for them.
  const routed = new Set(leaves.flatMap((l) => (l.items || []).map((i) => i.family)));
  const unroutable = priced.filter((fid) => !routed.has(fid));
  const unroutableSkus = unroutable.flatMap((fid) => (skusByFam.get(fid) || []).map((s) => s.sku_id));
  const accounted_skus = [...priceUnknownSkus, ...unroutableSkus];

  return {
    tree, leaves, mode, d_star: dStar,
    oversized_leaf_count: leaves.filter((l) => l.oversized).length,
    biggest_leaf: leaves.reduce((m, l) => Math.max(m, l.count), 0),
    price_unknown: { families: noPrice, skus: priceUnknownSkus }, // accounted, no CTA, never in a band
    unroutable: { families: unroutable, skus: unroutableSkus },   // accounted, → merchant queue (no product_type)
    accounted_skus,                                               // union: exempt from sku_in_leaf (all accounted, none silent)
  };
}

/** Tree-DERIVED elicitability (never a hand-written per-axis rule): an intent is elicitable ⇔ there is a
 *  path in the PUBLISHED tree where every SPECIFIC (non-wildcard) constraint value is an actual published
 *  option AND that axis is actually asked on the path. A specific constraint whose axis the tree never asks
 *  (e.g. origin in a branch that publishes no origin question) is NOT elicitable. Wildcard values ("any")
 *  need no question. Generic over any axis — a Part-3 axis needs no new code here. */
export function isElicitable(tree, answers = {}, wildcards = ["any"]) {
  const isWild = (v) => v == null || wildcards.includes(v);
  const required = Object.keys(answers).filter((a) => !isWild(answers[a])); // axes that MUST be asked with their value
  function walk(node, asked) {
    if (node.kind === "leaf") return required.every((a) => asked.has(a));
    const want = answers[node.axis];
    if (want !== undefined && !isWild(want)) {
      const opt = (node.options || []).find((o) => o.value === want);
      if (!opt) return false;                       // required value not a published option → not elicitable
      return walk(opt.child, new Set([...asked, node.axis]));
    }
    const opt = (node.options || []).find((o) => o.mandatory) || (node.options || []).find((o) => isWild(o.value)) || (node.options || [])[0];
    return opt ? walk(opt.child, asked) : false;    // wildcard/unspecified → follow the mandatory "any" path
  }
  return walk(tree, new Set());
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
