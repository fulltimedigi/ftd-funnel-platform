/** Generalization round — run the full brain pipeline on 5 non-perfume synthetic catalogs; structural checks
 *  via the SHARED poison-verified checker (no gold, no inline re-implementation). Reports mode + d*. */
import { discoverAxisContracts } from "../authoring/brain/axisContracts.js";
import { assignAxisRoles } from "../authoring/brain/axisRoles.js";
import { buildDecisionProfiles } from "../authoring/brain/decisionProfiles.js";
import { buildDecisionTree } from "../authoring/brain/decisionTree.js";
import { ingestToMatrices } from "./lib/realCatalog.mjs";
import { structuralViolations } from "./lib/structuralChecks.js";
import { ALL } from "./fixtures/generalization-catalogs.mjs";

async function run(cat) {
  const c = { domain: cat.domain, expectation: cat.expectation, fails: [], notes: [] };
  let familyMatrix, skuMatrix, disc, axes, r;
  try {
    ({ familyMatrix, skuMatrix } = await ingestToMatrices(JSON.stringify({ products: cat.products }), `https://${cat.domain}.test`, "USD"));
    disc = discoverAxisContracts(familyMatrix, skuMatrix);
    axes = assignAxisRoles(disc.published, familyMatrix);
    buildDecisionProfiles(axes, familyMatrix, skuMatrix);
    r = buildDecisionTree(axes, familyMatrix, skuMatrix);
  } catch (e) { c.mode = "ERROR"; c.published = "(pipeline threw)"; c.fails.push("pipeline explicit failure: " + e.message.slice(0, 100)); return c; }

  c.mode = `${r.mode} (d*=${r.d_star})`;
  c.published = disc.published.map((a) => a.axis_key === "price" ? "price" : `${a.axis_key}[${a.values.map((v) => v.value).slice(0, 4).join(",")}]`).join(" · ") || "(none)";
  c.fails = structuralViolations({ tree: r.tree, familyMatrix, skuMatrix, axes, accountedSkus: r.accounted_skus }).map((x) => `${x.check}: ${x.detail}`);
  if (r.accounted_skus.length) c.notes.push(`accounted (not dropped): ${r.price_unknown.skus.length} no-price + ${r.unroutable.skus.length} unroutable`);
  const pub = disc.published.map((a) => a.axis_key);
  if (cat.domain === "electronics" && !pub.includes("origin")) c.notes.push("no OS/compatibility hard axis (tags not mined) — known limit");
  if (cat.domain === "coffee") c.notes.push("roast (ordinal, in tags) NOT discovered — known limit");
  return c;
}

console.log("================ GENERALIZATION ROUND — 5 domains, shared checker, no gold ================\n");
const rows = [];
for (const cat of ALL) rows.push(await run(cat));
for (const r of rows) {
  console.log(`■ ${r.domain.toUpperCase()}  · mode=${r.mode}`);
  console.log(`   published: ${r.published}`);
  console.log(`   structural: ${r.fails.length ? "❌ " + r.fails.join(" · ") : "clean ✅"}`);
  if (r.notes.length) console.log(`   notes: ${r.notes.join(" · ")}`);
  console.log("");
}
const bad = rows.filter((r) => r.fails.length);
console.log("SUMMARY:", bad.length ? "structural failures in " + bad.map((r) => r.domain).join(", ") : "ALL 5 DOMAINS STRUCTURALLY CLEAN ✅");
