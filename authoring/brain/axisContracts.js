/**
 * authoring/brain/axisContracts.js — Part-2 brain, BUILD STEP 2: candidate axis discovery + gates.
 * ---------------------------------------------------------------------------------------------
 * Discovers candidate decision axes from the two matrices with SPAN-level evidence, then GATES them
 * so junk is rejected AT THE SOURCE (ق1/ق5/ق6), not cleaned downstream. The publish criterion is
 * VALUE-SUPPORT, never a raw coverage count (a count is the wrong instrument for a fit axis — it
 * publishes an axis where it serves nothing and drops it where it serves real matches). An axis
 * survives only if, inside its applicability scope:
 *   (i)  every published value has ≥1 real, purchasable product (Exact-support at the option level), AND
 *   (ii) ≥2 distinct grounded values exist (excluding the later mandatory "any" option). One value is
 *        effectively yes/no on a single product and dies in the anti-bland gate.
 * Other gates: clarity/token (whole shopper concept, not a fragment/unit/admin word) · evidence grade
 * (structured/title A/B; description C; D = review-only, out of runtime) · variant_specific exclusion
 * (a bundle's origin is per-box, not family-level — excluded from an origin axis in every store).
 *
 * Applicability scope ("نطاق انطباق معرَّف"): a *catalog* axis (type, price) applies to every family;
 * a *facet* axis (origin) applies only PER BRANCH (structured product_type) where it is grounded — so
 * coverage/support is judged inside the branch, never against families it never applies to.
 *
 * Why origin (a fit axis) is kept despite sparsity: it passes the ORDINARY material-impact test —
 * removing it changes the outcome of real intents (oil|*|indian). This is NOT ق12 ("eligibility judged
 * by error-risk not branch size"), which governs HARD eligibility questions; recording that as the
 * rationale would later smuggle weak axes through under an "error-risk" cover. The rationale here is
 * plain: value-supported + material impact.
 *
 * axis_role is NOT assigned here (Step 3). Pure, deterministic. LLM naming/clarity judging is later.
 */

const JUNK = new Set(["de", "based", "packages", "parfum", "perfume", "creations", "experiences",
  "extrait", "eau", "new", "sale", "set", "pack", "box", "kit", "ml", "gm", "gr", "gram", "grams", "tola", "the", "and", "for", "with"]);
// facet values (title/description fragments) must clear the JUNK filter; a STRUCTURED category name
// (product_type) is the merchant's authoritative label — never junk-filtered (e.g. "Packages" is a real
// category, not the fragment 'packages'). So catalog-scope axes get the base check only.
const clarityBase = (v) => { const s = String(v || "").trim().toLowerCase(); return s.length >= 2 && /[a-z؀-ۿ]/.test(s) && !/^\d+$/.test(s); };
const clarity = (v) => { const s = String(v || "").trim().toLowerCase(); return s.length >= 3 && !JUNK.has(s) && /[a-z؀-ۿ]/.test(s) && !/^\d+$/.test(s); };
const clarityFor = (v, scope) => (scope === "catalog" ? clarityBase(v) : clarity(v));
const INSPIRATION = /(inspired|inspiration|almost|hotondo|homage|reminiscent|deep love|my love|i made|ignited from|creation|interpretation|journey|adventure|hypnotic)/i;
const MATERIAL = /(agarwood|oud oil|\boud\b|\bwood\b|100%|\bpure\b|from the region)/i;
const BUNDLE = /\b(box|set|bundle|kit|collection)\b/i; // a curated multi-item family → origin is per-box (variant_specific)
const ORIGINS = ["indian", "cambodi", "cambodian", "malaysian", "borneo", "kalimantan", "hindi", "thai", "laotian", "vietnam"];

function tokens(s) { return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(Boolean); }

export function discoverAxisContracts(familyMatrix = [], skuMatrix = [], opts = {}) {
  const N = familyMatrix.length || 1;
  const candidates = [];

  // family → branch (structured product_type) and branch → families
  const familyBranch = new Map();
  const branchFamilies = new Map();
  for (const f of familyMatrix) {
    const b = (f.structured && f.structured.product_type) || "(none)";
    familyBranch.set(f.family_id, b);
    if (!branchFamilies.has(b)) branchFamilies.set(b, new Set());
    branchFamilies.get(b).add(f.family_id);
  }

  // Exact-support: a family is "supported" if it has ≥1 purchasable SKU (real product with a buy URL).
  const sellable = new Set();
  for (const s of skuMatrix) if (s.buy_url && s.availability !== "out_of_stock" && s.availability !== "discontinued") sellable.add(s.family_id);
  const isSupported = (fid) => sellable.has(fid);

  // variant_specific (bundle) families: their origin is per-box, not family-level → out of the origin axis (ق4).
  const variantSpecific = new Set();
  for (const f of familyMatrix) {
    const title = (f.text && f.text.title) || "";
    const desc = (f.text && f.text.description) || "";
    const distinctOrigins = new Set();
    for (const o of ORIGINS) if (new RegExp(`\\b${o}\\w*`, "i").test(desc)) distinctOrigins.add(o === "cambodian" ? "cambodi" : o);
    if (BUNDLE.test(title) || distinctOrigins.size > 1) variantSpecific.add(f.family_id);
  }

  // A) structured product-type axis (catalog-wide; evidence = the structured field; grade A)
  {
    const map = new Map();
    for (const f of familyMatrix) { const t = (f.structured && f.structured.product_type) || ""; if (!t) continue; if (!map.has(t)) map.set(t, []); map.get(t).push({ family: f.family_id, evidence: "structured:product_type=" + t }); }
    const values = [...map.entries()].map(([value, ev]) => ({ value, families: ev.map((e) => e.family), evidence: ev.map((e) => e.evidence) }));
    if (values.length) candidates.push({ axis_key: "type", source: "structured", grade: "A", scope: "catalog", values });
  }

  // B) price ordinal axis (catalog-wide; discovered bands, not pre-named budget; grade A)
  {
    const prices = skuMatrix.map((s) => s.price).filter((n) => typeof n === "number").sort((a, b) => a - b);
    if (prices.length >= 3) {
      const t1 = prices[Math.floor(prices.length / 3)], t2 = prices[Math.floor(2 * prices.length / 3)];
      const bandOf = (p) => (p <= t1 ? "low" : p >= t2 ? "high" : "mid");
      const map = new Map([["low", []], ["mid", []], ["high", []]]);
      for (const f of familyMatrix) { const p = (f.prices || [])[0]; if (p == null) continue; map.get(bandOf(p)).push(f.family_id); }
      const label = { low: `price ≤ ${t1}`, mid: `price ${t1}–${t2}`, high: `price ≥ ${t2}` };
      const values = [...map.entries()].filter(([, fams]) => fams.length).map(([value, fams]) => ({ value, families: fams, evidence: [`${label[value]} (${fams.length} families)`] }));
      if (values.length >= 2) candidates.push({ axis_key: "price", source: "structured", grade: "A", scope: "catalog", ordinal: true, values });
    }
  }

  // C) origin axis from DESCRIPTION material-adjacent spans (branch-conditional; grade C).
  //    variant_specific/bundle families are excluded — a box's origin is per-box, not the family's.
  {
    const map = new Map();
    for (const f of familyMatrix) {
      if (variantSpecific.has(f.family_id)) continue; // per-box origin ≠ family origin (ق4)
      const desc = (f.text && f.text.description) || "";
      if (INSPIRATION.test(desc)) continue;
      for (const o of ORIGINS) {
        const m = new RegExp(`\\b${o}\\w*`, "i").exec(desc); if (!m) continue;
        const window = desc.slice(Math.max(0, m.index - 40), m.index + 40).trim();
        if (!MATERIAL.test(window)) continue;
        const key = o === "cambodian" ? "cambodi" : o;
        if (!map.has(key)) map.set(key, []); map.get(key).push({ family: f.family_id, evidence: window });
        break;
      }
    }
    const values = [...map.entries()].map(([value, ev]) => ({ value, families: ev.map((e) => e.family), evidence: ev.map((e) => e.evidence) }));
    if (values.length) candidates.push({ axis_key: "origin", source: "description", grade: "C", scope: "facet", values });
  }

  // D) title-token facet (candidate that SHOULD fail the gates — proves junk is rejected at source)
  {
    const df = new Map();
    for (const f of familyMatrix) for (const t of new Set(tokens(f.text && f.text.title))) { if (!df.has(t)) df.set(t, []); df.get(t).push(f.family_id); }
    const values = [...df.entries()].filter(([, fams]) => fams.length >= 1).map(([value, fams]) => ({ value, families: fams, evidence: ["title token"] }));
    if (values.length) candidates.push({ axis_key: "title_tokens", source: "title", grade: "D", scope: "facet", values });
  }

  // ---- gates: value-support, NOT a coverage count ----
  const published = [], rejected = [];
  for (const c of candidates) {
    const clean = c.values.filter((v) => clarityFor(v.value, c.scope));
    const junkVals = c.values.filter((v) => !clarityFor(v.value, c.scope)).map((v) => v.value);
    if (clean.length < 2) { rejected.push({ axis_key: c.axis_key, reason: `clarity: <2 meaningful values (raw tokens: ${junkVals.slice(0, 6).join(",") || "n/a"})` }); continue; }
    if (c.grade === "D") { rejected.push({ axis_key: c.axis_key, reason: "evidence grade D (weak token) — review only, not runtime (ق10)" }); continue; }

    if (c.scope === "catalog") {
      // catalog-wide axis: every family has a value; judged over the whole catalog.
      const vals = clean.filter((v) => v.families.some(isSupported));                 // (i) each value Exact-supported
      if (vals.length < 2) { rejected.push({ axis_key: c.axis_key, reason: "<2 Exact-supported values (catalog)" }); continue; } // (ii)
      const supported = new Set(vals.flatMap((v) => v.families.filter(isSupported)));
      const maxShare = Math.max(...vals.map((v) => v.families.length)) / N;
      if (maxShare >= 0.95) { rejected.push({ axis_key: c.axis_key, reason: `no distinction (one value ${(maxShare * 100).toFixed(0)}%)` }); continue; }
      published.push({ axis_key: c.axis_key, source: c.source, grade: c.grade, scope: c.scope, ordinal: !!c.ordinal, values: vals,
        applicability: { kind: "catalog", branches: [...branchFamilies.keys()], supported_families: [...supported] } });
      continue;
    }

    // facet axis: branch-conditional. A branch qualifies only if it holds ≥2 distinct Exact-supported
    // values (conditions i+ii together, per branch). Applicability = the qualifying branches only.
    const branchVals = new Map(); // branch -> Map(value -> [supported family ids])
    for (const v of clean) for (const fid of v.families) {
      if (!isSupported(fid)) continue;
      const b = familyBranch.get(fid); if (!b) continue;
      if (!branchVals.has(b)) branchVals.set(b, new Map());
      const m = branchVals.get(b); if (!m.has(v.value)) m.set(v.value, []); m.get(v.value).push(fid);
    }
    const qualifying = [...branchVals.entries()].filter(([, m]) => m.size >= 2);
    if (!qualifying.length) {
      const best = [...branchVals.entries()].sort((a, b) => b[1].size - a[1].size)[0];
      rejected.push({ axis_key: c.axis_key, reason: `no branch has ≥2 distinct Exact-supported values (best: ${best ? best[0] + " " + best[1].size : "none"})` });
      continue;
    }
    const supported = new Set(qualifying.flatMap(([b]) => [...branchFamilies.get(b)]));
    const scopedValues = clean
      .map((v) => ({ ...v, families: v.families.filter((fid) => supported.has(fid) && isSupported(fid)) }))
      .filter((v) => v.families.length);
    const branch_values = Object.fromEntries(qualifying.map(([b, m]) => [b, [...m.keys()]]));
    published.push({ axis_key: c.axis_key, source: c.source, grade: c.grade, scope: c.scope, ordinal: !!c.ordinal, values: scopedValues,
      applicability: { kind: "branch-conditional", branches: qualifying.map(([b]) => b), supported_families: [...supported], branch_values } });
  }
  return { published, rejected };
}
