/**
 * tests/lib/structuralChecks.js — the ONE structural checker for the decision tree, returning a list of
 * violations (never throwing). Extracted so it can be exercised on BOTH clean input (oudfactory → zero
 * violations) AND poison input (a poison canary → the violation MUST be caught). A checker that only ever
 * runs on clean data can pass vacuously — that is exactly how a no-price product slipped through "every
 * SKU in a leaf". Each check below names the violation it detects.
 */
import { traverse } from "../../authoring/brain/decisionTree.js";

const BANDS = ["low", "mid", "high"];

export function structuralViolations({ tree, familyMatrix, skuMatrix, axes }) {
  const v = [];
  const famType = new Map(familyMatrix.map((f) => [f.family_id, (f.structured && f.structured.product_type) || "(none)"]));
  const famBand = new Map(); { const pa = axes.find((a) => a.axis_key === "price"); if (pa) for (const val of pa.values) for (const fid of val.families) famBand.set(fid, val.value); }
  const famOrigin = new Map(); { const oa = axes.find((a) => a.axis_key === "origin"); if (oa) for (const val of oa.values) for (const fid of val.families) famOrigin.set(fid, val.value); }

  const qs = []; (function w(n) { if (n && n.kind === "question") { qs.push(n); (n.options || []).forEach((o) => w(o.child)); } })(tree);
  const leaves = []; (function w(n) { if (!n) return; if (n.kind === "leaf") leaves.push(n); else (n.options || []).forEach((o) => w(o.child)); })(tree);
  const leafCount = (n) => (!n ? 0 : n.kind === "leaf" ? n.count : (n.options || []).reduce((s, o) => s + leafCount(o.child), 0));

  // EMPTY-TRUTH GUARD: a catalog with products must produce at least one leaf. Without this, every
  // "for each leaf/option, check X" below would pass VACUOUSLY on an empty tree (`.every([])===true`).
  if (skuMatrix.length > 0 && leaves.length === 0) v.push({ check: "empty_tree", detail: "products exist but the tree has no leaf (would make all per-leaf checks vacuous)" });

  // (0) NO DEGENERATE QUESTION — a question with 0 options. This is the gap that let `.every([])===true`
  // pass vacuously; a degenerate node is an unanswerable dead screen for the shopper.
  for (const q of qs) if (!q.options || q.options.length === 0) v.push({ check: "degenerate_question", detail: `question '${q.axis}' has 0 options` });

  // (1) EXACT-SUPPORT — every published option ultimately holds ≥1 product.
  for (const q of qs) for (const o of (q.options || [])) if (leafCount(o.child) < 1) v.push({ check: "exact_support", detail: `option ${q.axis}=${o.value} has 0 candidates` });

  // (2) NO EMPTY LEAF + mandatory 'any' on every fit(origin) question.
  for (const l of leaves) if (l.count < 1) v.push({ check: "empty_leaf", detail: "leaf with 0 products" });
  for (const q of qs) if (q.axis === "origin" && !(q.options || []).some((o) => o.value === "any")) v.push({ check: "missing_any_compass", detail: "origin question without mandatory 'any'" });

  // (3) LEAF PATH SATISFACTION — every product in a leaf satisfies every constraint on its path.
  for (const l of leaves) for (const it of (l.items || [])) {
    if (l.path.type != null && famType.get(it.family) !== l.path.type) v.push({ check: "path_satisfaction", detail: `${it.family} wrong type in ${l.path.type}` });
    if (l.path.ceiling != null && BANDS.indexOf(famBand.get(it.family)) > l.path.ceiling) v.push({ check: "path_satisfaction", detail: `${it.family} over budget` });
    if (l.path.origin != null && l.path.origin !== "any" && famOrigin.get(it.family) !== l.path.origin) v.push({ check: "path_satisfaction", detail: `${it.family} wrong origin` });
  }

  // (4) EVERY NON-EXCLUDED SKU APPEARS IN ≥1 LEAF — a product that reaches no leaf is a silent drop (ق2).
  const allSku = new Set(skuMatrix.map((s) => s.sku_id));
  const leafSku = new Set(leaves.flatMap((l) => l.skus || []));
  const missing = [...allSku].filter((s) => !leafSku.has(s));
  if (missing.length) v.push({ check: "sku_in_leaf", detail: `${missing.length} SKU(s) reach no leaf (silent drop): ${missing.slice(0, 3).join(", ")}` });

  // (5) FUZZ — a corrupted answer must never fabricate a result.
  if (qs.length && traverse(tree, { [qs[0].axis]: "__garbage__" }).no_result !== true) v.push({ check: "fuzz", detail: "corrupted answer did not return no_result" });

  return v;
}
