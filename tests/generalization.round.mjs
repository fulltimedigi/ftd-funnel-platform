/** Generalization round — run the full brain pipeline on 5 non-perfume synthetic catalogs; structural checks only (no gold). */
import { loadIngestPolicy } from "../authoring/ingest/policy.js";
import { skusFromShopifyJson } from "../authoring/ingest/shopify.js";
import { buildSkuLedger } from "../authoring/ingest/skuLedger.js";
import { buildLedgerMatrices } from "../authoring/brain/ledgerMatrices.js";
import { discoverAxisContracts } from "../authoring/brain/axisContracts.js";
import { assignAxisRoles } from "../authoring/brain/axisRoles.js";
import { buildDecisionProfiles } from "../authoring/brain/decisionProfiles.js";
import { buildDecisionTree, traverse } from "../authoring/brain/decisionTree.js";
import { ALL } from ".//fixtures/generalization-catalogs.mjs";

const pol = await loadIngestPolicy();
const BANDS = ["low", "mid", "high"];

async function run(cat) {
  const origin = `https://${cat.domain}.test`;
  const c0 = { domain: cat.domain, expectation: cat.expectation, fails: [], notes: [] };
  let ext, ledger, familyMatrix, skuMatrix, disc, axes, profiles, tree = null, treeErr = null;
  try {
    ext = skusFromShopifyJson(JSON.stringify({ products: cat.products }), origin, "USD");
    ledger = buildSkuLedger(ext, { sourceActiveSkus: ext.sourceActiveSkus, method: "shopify", autoExcludeCategories: pol.auto_exclude_categories });
    ({ familyMatrix, skuMatrix } = buildLedgerMatrices(ledger, cat.products));
    disc = discoverAxisContracts(familyMatrix, skuMatrix);
    axes = assignAxisRoles(disc.published, familyMatrix);
    profiles = buildDecisionProfiles(axes, familyMatrix, skuMatrix);
  } catch (e) {
    c0.published = "(pipeline threw)"; c0.profiles = 0; c0.rootKind = "ERROR";
    c0.fails.push("pipeline explicit failure: " + e.message.slice(0, 120));
    return c0;
  }
  try { tree = buildDecisionTree(axes, familyMatrix, skuMatrix); } catch (e) { treeErr = e.message; }

  const famType = new Map(familyMatrix.map((f) => [f.family_id, f.structured.product_type]));
  const famBand = new Map(); { const pa = axes.find((a) => a.axis_key === "price"); if (pa) for (const v of pa.values) for (const fid of v.families) famBand.set(fid, v.value); }
  const famOrigin = new Map(); { const oa = axes.find((a) => a.axis_key === "origin"); if (oa) for (const v of oa.values) for (const fid of v.families) famOrigin.set(fid, v.value); }

  const c = { domain: cat.domain, expectation: cat.expectation, fails: [], notes: [] };
  c.published = disc.published.map((a) => `${a.axis_key}${a.axis_key === "price" ? "" : "[" + a.values.map((v) => v.value).slice(0, 4).join(",") + "]"}`).join(" · ") || "(none)";
  c.profiles = profiles.after;

  // 1. accounting
  if (ledger.accounting.unaccounted_active_skus !== 0) c.fails.push(`accounting: unaccounted=${ledger.accounting.unaccounted_active_skus}`);
  // 2. no pre-named axes / no raw tokens published
  const pub = disc.published.map((a) => a.axis_key);
  if (pub.includes("title_tokens")) c.fails.push("raw title-tokens published");
  if (!pub.every((k) => ["type", "price", "origin"].includes(k))) c.fails.push("unexpected axis key: " + pub.join(","));

  if (treeErr) { c.fails.push("tree build threw: " + treeErr); c.rootKind = "ERROR"; return c; }
  c.rootKind = tree.tree.kind;
  c.rootOptions = tree.tree.options ? tree.tree.options.length : 0;
  const qs = []; (function w(n) { if (n.kind === "question") { qs.push(n); n.options.forEach((o) => w(o.child)); } })(tree.tree);
  const leafCount = (n) => (n.kind === "leaf" ? n.count : n.options.reduce((s, o) => s + leafCount(o.child), 0));

  // 3. exact-support + 4. no empty branch
  for (const q of qs) for (const o of q.options) if (leafCount(o.child) < 1) c.fails.push(`empty option ${q.axis}=${o.value}`);
  for (const l of tree.leaves) if (l.count < 1) c.fails.push("empty leaf");
  // degenerate: a question with zero options (no-axis mode leak)
  for (const q of qs) if (!q.options.length) c.fails.push(`degenerate question ${q.axis} with 0 options`);
  // 5. leaf path satisfaction
  for (const l of tree.leaves) for (const it of l.items) {
    if (l.path.type != null && famType.get(it.family) !== l.path.type) c.fails.push(`leaf type mismatch ${it.family}`);
    if (l.path.ceiling != null && BANDS.indexOf(famBand.get(it.family)) > l.path.ceiling) c.fails.push(`leaf budget breach ${it.family}`);
    if (l.path.origin != null && l.path.origin !== "any" && famOrigin.get(it.family) !== l.path.origin) c.fails.push(`leaf origin mismatch ${it.family}`);
  }
  // 6. every non-excluded SKU in a leaf
  const allSku = new Set(skuMatrix.map((s) => s.sku_id));
  const leafSku = new Set(tree.leaves.flatMap((l) => l.skus));
  const missing = [...allSku].filter((s) => !leafSku.has(s));
  if (missing.length) c.fails.push(`SKUs not in any leaf: ${missing.length}`);
  // 7. fuzz — corrupted answer never fabricates
  if (traverse(tree.tree, { type: "__garbage__", price: "low" }).no_result !== true) c.fails.push("fuzz: corrupted answer did not return no_result");

  // special modes
  if (cat.domain === "tiny" && tree.tree.kind === "question") c.notes.push("MODE-MISS: tiny catalog still builds a QUIZ (ق20 grid mode not implemented)");
  if (cat.domain === "no-axis") { const onlyType = pub.length === 0 || (pub.length === 1); if (tree.tree.kind === "question") c.notes.push("MODE-MISS: no-axis still builds a question (ق16 recommendation-light not implemented)"); }
  // domain-axis presence (the oud-shaping probe)
  if (cat.domain === "electronics" && !pub.some((k) => k === "origin")) c.notes.push("no OS/compatibility hard axis (attributes in tags are not mined)");
  if (cat.domain === "coffee") c.notes.push("roast (ordinal, in tags) " + (pub.length > 2 ? "discovered" : "NOT discovered — only type+price"));
  return c;
}

console.log("================ GENERALIZATION ROUND — 5 domains, structural (no gold) ================\n");
const rows = [];
for (const cat of ALL) rows.push(await run(cat));
for (const r of rows) {
  console.log(`■ ${r.domain.toUpperCase()}  (profiles=${r.profiles}, root=${r.rootKind})`);
  console.log(`   expected : ${r.expectation}`);
  console.log(`   published: ${r.published}`);
  console.log(`   structural FAILS: ${r.fails.length ? r.fails.join(" · ") : "none ✅"}`);
  if (r.notes.length) console.log(`   findings : ${r.notes.join(" · ")}`);
  console.log("");
}
const structFails = rows.filter((r) => r.fails.length);
console.log("SUMMARY: structural failures in", structFails.length, "/", rows.length, "domains:", structFails.map((r) => r.domain).join(", ") || "none");
