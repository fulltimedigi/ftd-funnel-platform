/**
 * scratch-audit/invariant.mjs — PROACTIVE store-agnostic invariant audit (not committed).
 * Runs the REAL authoring pipeline on DIVERSE synthetic catalogs and asks one question
 * per store: does every question we ask actually get honored in the result, or does the
 * scorer silently override the shopper's explicit choice?
 *
 * For each generated funnel it walks EVERY decision-table rule and, for every axis, checks
 * whether the recommended product truly carries the value the rule chose. Categorical axes
 * (type/format/etc.) must be EXACT; a price/budget axis must fall inside the chosen band.
 * Reports violations per axis so we can see exactly where a promise is broken — on any store.
 */
import { authorFunnel } from "../authoring/author/index.js";
import { productFormat } from "../authoring/author/formatAxis.js";

const num = (v) => { const n = parseFloat(String(v).replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; };

/* ---- diverse synthetic stores (different verticals, price shapes, attributes) ---- */
const STORES = [];

// 1) OUD / perfume — has the hard FORMAT dimension (spray / oil / raw / set). POSITIVE
// CONTROL: format is the ONE axis we already made hard (ADR-0034) — expect 0 leaks on it.
const scents = ["woody","floral","smoky"];
STORES.push({ vertical: "عطور وعود", origin: "https://oud.example", products: [
  ...Array.from({length:8},(_ ,i)=>({ name:`${["Hindi","Cambodi","Royal","Sultan","Amber","Musk","Rose","Taif"][i]} Eau De Parfum`, url:`https://oud.example/p/parf${i}`, price:300+i*90, attributes:{type:"Perfume"}, differentiators:[scents[i%3],"perfume"] })),
  ...Array.from({length:6},(_ ,i)=>({ name:`${["Hindi","Cambodi","Borneo","Trat","Maroke","Seufi"][i]} Oud Oil 3ml`, url:`https://oud.example/p/oil${i}`, price:250+i*220, attributes:{type:"Oud Oil"}, differentiators:[scents[i%3],"oil"] })),
  ...Array.from({length:4},(_ ,i)=>({ name:`${["Hindi","Malaysian","Kalimantan","Indian"][i]} Agarwood Chips 30g`, url:`https://oud.example/p/wood${i}`, price:600+i*500, attributes:{type:"Wood"}, differentiators:[scents[i%3],"raw"] })),
  { name:"Luxury Gift Set", url:"https://oud.example/p/set0", price:2200, attributes:{type:"Set"}, differentiators:["woody","set"] },
  { name:"Discovery Gift Set", url:"https://oud.example/p/set1", price:1800, attributes:{type:"Set"}, differentiators:["floral","set"] },
]});

// 2) LAPTOPS — categorical brand + os + a wide price spread (a classic "spec" funnel)
STORES.push({ vertical: "لابتوبات", origin: "https://tech.example", products:
  [["Air 13","apple","macos",1200],["Pro 14","apple","macos",2400],["Pro 16","apple","macos",3500],
   ["XPS 13","dell","windows",1100],["XPS 15","dell","windows",1900],["G15 Gamer","dell","windows",1500],
   ["ThinkPad X1","lenovo","windows",1700],["Legion 5","lenovo","windows",1400],["IdeaPad 3","lenovo","windows",600],
   ["Chromebook Go","hp","chromeos",400],["Pavilion 15","hp","windows",800],["Spectre x360","hp","windows",1600]]
   .map(([n,brand,os,price],i)=>({ name:`${brand} ${n}`, url:`https://tech.example/p/${i}`, price, brand, attributes:{type:os}, differentiators:[brand,os] }))
});

// 3) SUPPLEMENTS — goal-type categorical + price bands
STORES.push({ vertical: "مكمّلات غذائية", origin: "https://supp.example", products:
  [["Whey Protein","muscle",180],["Mass Gainer","muscle",220],["Creatine","muscle",90],
   ["Multivitamin","health",70],["Omega-3","health",110],["Vitamin D","health",45],
   ["Fat Burner","weight",160],["CLA","weight",130],["L-Carnitine","weight",95],
   ["Pre-Workout","energy",140],["BCAA","energy",120]]
   .map(([n,goal,price],i)=>({ name:n, url:`https://supp.example/p/${i}`, price, attributes:{type:goal}, differentiators:[goal] }))
});

// 4) COFFEE — roast + origin categorical, tight price range
STORES.push({ vertical: "قهوة مختصة", origin: "https://coffee.example", products:
  [["Ethiopia Light","light",65],["Kenya Light","light",70],["Colombia Medium","medium",55],
   ["Brazil Medium","medium",50],["Guatemala Medium","medium",58],["Sumatra Dark","dark",52],
   ["Italian Dark","dark",48],["Espresso Blend","dark",45],["House Blend","medium",40],["Decaf Medium","medium",42]]
   .map(([n,roast,price],i)=>({ name:n, url:`https://coffee.example/p/${i}`, price, attributes:{type:roast}, differentiators:[roast] }))
});

/* ---- the invariant check for one generated config ---- */
function audit(config, catalog) {
  const byUrl = new Map(catalog.products.map((p) => [p.url, p]));
  const A = {}; for (const a of config.archetypes || []) A[a.id] = a.recommendations && a.recommendations.primary;
  const rules = config.decisionTable || [];
  // classify each derived signal: is it a categorical facet, or the price/budget axis?
  const sigs = config.signals || [];
  const priceLike = (id) => /budget|price|سعر|ميزاني/i.test(id);
  // budget band ranges from option labels (numbers) — best-effort
  const perAxis = {};
  let anyChecked = 0;
  for (const x of rules) {
    if (!x.when) continue;
    const rec = A[x.result]; if (!rec) continue;
    const realP = byUrl.get(rec.url); // full product (has attributes/price)
    for (const [D, want] of Object.entries(x.when)) {
      const axisId = D.replace(/^D_/, "");
      perAxis[axisId] = perAxis[axisId] || { checked: 0, violated: 0, examples: [] };
      let ok = null; // null = can't determine (skip)
      if (priceLike(axisId)) {
        // find the option label range for `want`
        const q = (config.questions || []).find((q) => q.id === `q_${axisId}`);
        // map value->label via signal map
        const sig = sigs.find((s) => s.id === `s_${axisId}`);
        const optId = sig && Object.keys(sig.map || {}).find((k) => sig.map[k] === want);
        const label = q && (q.options.find((o) => o.id === optId) || {}).label || "";
        const nums = (label.match(/\d[\d.,]*/g) || []).map((s) => num(s));
        const price = num(realP && realP.price);
        if (price != null && nums.length) {
          if (/أقل|less|<|حتى|under/i.test(label) && nums.length >= 1) ok = price < nums[0] * 1.0 || price <= nums[nums.length-1];
          if (nums.length >= 2) ok = price >= nums[0] && price <= nums[1];
          else if (/أكثر|more|>|فوق|over/i.test(label)) ok = price > nums[0];
        }
      } else {
        // categorical: the product's own value on this axis == want?
        // derive from format (if format axis) else from attributes.type / differentiators
        let pv = null;
        if (axisId === "format") pv = productFormat(realP);
        else {
          const t = (realP && realP.attributes && realP.attributes.type || "").toString().toLowerCase();
          const diffs = (realP && realP.differentiators || []).map((d) => String(d).toLowerCase());
          pv = ([t, ...diffs].includes(String(want).toLowerCase())) ? want
             : (t === String(want).toLowerCase() ? want : null);
          // if we simply can't tell, leave null (don't count) — honest
          if (pv == null && (t || diffs.length)) {
            // only flag as violation when the product clearly has a DIFFERENT value in the axis domain
            const sig = sigs.find((s) => s.id === `s_${axisId}`);
            const domain = (sig && sig.domain) || [];
            const holds = domain.filter((v) => [t, ...diffs].includes(String(v).toLowerCase()));
            if (holds.length === 1) pv = holds[0]; // product clearly belongs to one value
          }
        }
        if (pv != null) ok = (String(pv) === String(want));
      }
      if (ok === null) continue;
      perAxis[axisId].checked++; anyChecked++;
      if (!ok) { perAxis[axisId].violated++; if (perAxis[axisId].examples.length < 4) perAxis[axisId].examples.push(`${want} -> "${rec.name}" (${realP&&realP.price!=null?realP.price:'?'})`); }
    }
  }
  return { rules: rules.length, anyChecked, perAxis };
}

/* ---- run ---- */
console.log("PROACTIVE INVARIANT AUDIT — is every question we ask actually honored?\n");
let grandViol = 0;
for (const s of STORES) {
  const cat = { origin: s.origin, products: s.products, brandUrl: s.origin };
  const gen = authorFunnel(cat, { brandName: s.vertical });
  console.log(`\n══ ${s.vertical}  (${s.products.length} products) ══`);
  if (!gen.ok) { console.log(`  ⚠ author failed: ${gen.reason}`); continue; }
  console.log(`  axes: [${gen.meta.axes.join(", ")}]  · rules: ${(gen.config.decisionTable||[]).length}`);
  const r = audit(gen.config, cat);
  for (const [axis, m] of Object.entries(r.perAxis)) {
    const flag = m.violated > 0 ? "🔴" : "✅";
    console.log(`  ${flag} axis "${axis}": ${m.violated}/${m.checked} rules VIOLATE the shopper's choice`);
    if (m.violated > 0) { m.examples.forEach((e) => console.log(`        ✗ ${e}`)); grandViol += m.violated; }
  }
  if (r.anyChecked === 0) console.log("  (could not verify any axis from synthetic data)");
}
console.log(`\n${"─".repeat(50)}\nTOTAL promise-violations across all stores: ${grandViol}`);
console.log(grandViol === 0 ? "✅ every question honored on every store" : "🔴 the scorer overrides shopper choices on some stores");
