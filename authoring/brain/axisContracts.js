/**
 * authoring/brain/axisContracts.js — Part-2 brain, BUILD STEP 2: candidate axis discovery + gates.
 * ---------------------------------------------------------------------------------------------
 * Discovers candidate decision axes from the two matrices with SPAN-level evidence, then GATES them
 * so junk is rejected AT THE SOURCE (ق1/ق5/ق6), not cleaned downstream:
 *   • clarity/token gate  — a value must be a whole, meaningful shopper concept, never a raw token /
 *     fragment / unit / admin word ('de','based','packages','parfum','ml','tola'…).
 *   • grounding coverage  — enough families carry an evidence-backed value.
 *   • distinctiveness     — the axis actually splits the catalog (not one value ≈ all).
 *   • evidence grade      — structured/title = A/B (hard-eligible); description = C (soft only);
 *     D (weak token/LLM guess) is REVIEW-ONLY → rejected from runtime.
 *   • type-homogeneity    — every value shares the axis's evidence source/cue (an origin⊕product-line
 *     mix is rejected). Built per-source, so homogeneity holds by construction here.
 * axis_role is NOT assigned here (Step 3). Pure, deterministic. LLM naming/clarity judging is a later
 * authoring pass; this layer keeps only what survives deterministic gates.
 */

const JUNK = new Set(["de", "based", "packages", "parfum", "perfume", "creations", "experiences",
  "extrait", "eau", "new", "sale", "set", "pack", "box", "kit", "ml", "gm", "gr", "gram", "grams", "tola", "the", "and", "for", "with"]);
const clarity = (v) => { const s = String(v || "").trim().toLowerCase(); return s.length >= 3 && !JUNK.has(s) && /[a-z؀-ۿ]/.test(s) && !/^\d+$/.test(s); };
const INSPIRATION = /(inspired|inspiration|almost|hotondo|homage|reminiscent|deep love|my love|i made|ignited from|creation|interpretation|journey|adventure|hypnotic)/i;
const MATERIAL = /(agarwood|oud oil|\boud\b|\bwood\b|100%|\bpure\b|from the region)/i;
const ORIGINS = ["indian", "cambodi", "cambodian", "malaysian", "borneo", "kalimantan", "hindi", "thai", "laotian", "vietnam"];

function tokens(s) { return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(Boolean); }

export function discoverAxisContracts(familyMatrix = [], skuMatrix = [], opts = {}) {
  const minCoverage = opts.minCoverage ?? 0.3;
  const N = familyMatrix.length || 1;
  const candidates = [];

  // A) structured product-type axis (evidence = the structured field; grade A)
  {
    const map = new Map();
    for (const f of familyMatrix) { const t = (f.structured && f.structured.product_type) || ""; if (!t) continue; if (!map.has(t)) map.set(t, []); map.get(t).push({ family: f.family_id, evidence: "structured:product_type=" + t }); }
    const values = [...map.entries()].map(([value, ev]) => ({ value, families: ev.map((e) => e.family), evidence: ev.map((e) => e.evidence) }));
    if (values.length) candidates.push({ axis_key: "type", source: "structured", grade: "A", values });
  }

  // B) price ordinal axis (from the SKU matrix; discovered bands, not pre-named budget; grade A)
  {
    const prices = skuMatrix.map((s) => s.price).filter((n) => typeof n === "number").sort((a, b) => a - b);
    if (prices.length >= 3) {
      const t1 = prices[Math.floor(prices.length / 3)], t2 = prices[Math.floor(2 * prices.length / 3)];
      const bandOf = (p) => (p <= t1 ? "low" : p >= t2 ? "high" : "mid");
      const map = new Map([["low", []], ["mid", []], ["high", []]]);
      for (const f of familyMatrix) { const p = (f.prices || [])[0]; if (p == null) continue; map.get(bandOf(p)).push(f.family_id); }
      const label = { low: `price ≤ ${t1}`, mid: `price ${t1}–${t2}`, high: `price ≥ ${t2}` };
      const values = [...map.entries()].filter(([, fams]) => fams.length).map(([value, fams]) => ({ value, families: fams, evidence: [`${label[value]} (${fams.length} families)`] }));
      if (values.length >= 2) candidates.push({ axis_key: "price", source: "structured", grade: "A", ordinal: true, values });
    }
  }

  // C) origin axis from DESCRIPTION material-adjacent spans (no inspiration disclaimer; grade C)
  {
    const map = new Map();
    for (const f of familyMatrix) {
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
    if (values.length) candidates.push({ axis_key: "origin", source: "description", grade: "C", values });
  }

  // D) title-token facet (candidate that SHOULD fail the gates — proves junk is rejected at source)
  {
    const df = new Map();
    for (const f of familyMatrix) for (const t of new Set(tokens(f.text && f.text.title))) { if (!df.has(t)) df.set(t, []); df.get(t).push(f.family_id); }
    const values = [...df.entries()].filter(([, fams]) => fams.length >= 1).map(([value, fams]) => ({ value, families: fams, evidence: ["title token"] }));
    if (values.length) candidates.push({ axis_key: "title_tokens", source: "title", grade: "D", values });
  }

  // ---- branch partition (structured product_type) — the unit of applicability scope ----
  const branchFamilies = new Map(); // product_type -> Set(family_id)
  for (const f of familyMatrix) {
    const b = (f.structured && f.structured.product_type) || "(none)";
    if (!branchFamilies.has(b)) branchFamilies.set(b, new Set());
    branchFamilies.get(b).add(f.family_id);
  }

  // ---- gates ----
  // Grounding coverage is judged INSIDE each axis's applicability scope, NEVER the whole catalog
  // ("نطاق انطباق معرَّف"): a conditional axis (origin) applies only in the branch it is grounded in,
  // so measuring it against families it never applies to (perfumes/wood) is the wrong denominator.
  const published = [], rejected = [];
  for (const c of candidates) {
    const clean = c.values.filter((v) => clarity(v.value));
    const junkVals = c.values.filter((v) => !clarity(v.value)).map((v) => v.value);
    if (clean.length < 2) { rejected.push({ axis_key: c.axis_key, reason: `clarity: <2 meaningful values (raw tokens: ${junkVals.slice(0, 6).join(",") || "n/a"})` }); continue; }
    if (c.grade === "D") { rejected.push({ axis_key: c.axis_key, reason: "evidence grade D (weak token) — review only, not runtime (ق10)" }); continue; }

    // per-branch coverage: covered families in the branch ÷ families in the branch (the correct denominator)
    const coveredFamilies = new Set(clean.flatMap((v) => v.families));
    const perBranch = [...branchFamilies.entries()].map(([branch, fams]) => {
      let cov = 0; for (const fid of fams) if (coveredFamilies.has(fid)) cov++;
      return { branch, covered: cov, total: fams.size, coverage: fams.size ? cov / fams.size : 0 };
    });
    const qualifying = perBranch.filter((pb) => pb.coverage >= minCoverage);
    if (!qualifying.length) {
      const best = perBranch.slice().sort((a, b) => b.coverage - a.coverage)[0] || { coverage: 0, branch: "-" };
      rejected.push({ axis_key: c.axis_key, reason: `grounding coverage < ${minCoverage} in every branch (best: ${best.branch} ${best.coverage.toFixed(2)})`, per_branch: perBranch });
      continue;
    }
    const supported = new Set(qualifying.flatMap((q) => [...branchFamilies.get(q.branch)]));

    // confine values to the applicability scope; drop a value with no candidate inside scope (dead-value guard)
    const scopedValues = clean.map((v) => ({ ...v, families: v.families.filter((fid) => supported.has(fid)) })).filter((v) => v.families.length);
    if (scopedValues.length < 2) { rejected.push({ axis_key: c.axis_key, reason: `<2 values inside applicability scope [${qualifying.map((q) => q.branch).join(",")}]` }); continue; }

    // distinctiveness judged inside the scope, not the whole catalog
    const maxShare = Math.max(...scopedValues.map((v) => v.families.length)) / supported.size;
    if (maxShare >= 0.95) { rejected.push({ axis_key: c.axis_key, reason: `no distinction inside scope (one value ${(maxShare * 100).toFixed(0)}%)` }); continue; }

    published.push({
      axis_key: c.axis_key, source: c.source, grade: c.grade, ordinal: !!c.ordinal, values: scopedValues,
      applicability: { branches: qualifying.map((q) => q.branch), supported_families: [...supported], per_branch: perBranch },
    });
  }
  return { published, rejected };
}
