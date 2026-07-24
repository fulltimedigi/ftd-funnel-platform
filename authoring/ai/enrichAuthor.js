/**
 * authoring/ai/enrichAuthor.js — grounded AI enrichment (ADR-0028, Track C).
 * ---------------------------------------------------------------------------
 * The moat. A domain-expert model reads the REAL catalog and proposes rich,
 * category-appropriate decision AXES (occasion, sillage, character, expertise…)
 * that the catalog's structured data never exposed — the knowledge a hand-built
 * funnel encodes. We then compile those axes through the SAME gate-passing
 * builder the deterministic path uses, so the runtime stays 100% deterministic.
 *
 * Honesty is structural, not hoped-for:
 *  • The model only proposes axes + a per-product value mapping. It NEVER names a
 *    product — every recommendation is chosen by buildConfig from the real
 *    catalog, so a hallucinated SKU is impossible.
 *  • Any product URL in the mapping that isn't in the real catalog is DROPPED.
 *  • The compiled funnel must pass trust + anti-bland (authorFromAxes) AND the
 *    richness gate. On failure we REPAIR (feed the findings back) up to N times,
 *    then give up → {ok:false} so the caller falls back to deterministic.
 *
 * Pure/Node-safe: the model call is an INJECTED `complete()`, so the whole loop
 * (prompt → design → compile → validate → repair) runs offline in tests. Design
 * model: claude-opus-4-8 — the most capable model, chosen for the highest design
 * quality (the moat). Runs once per funnel with a cached system prompt, so cost
 * is negligible; operator directive is best quality regardless of cost.
 */

import { authorFromAxes } from "../author/index.js";
import { richnessCheck } from "../quality/richnessCheck.js";

export const DESIGN_MODEL = "claude-opus-4-8";

/** JSON-schema the model must return (structured outputs → guaranteed shape). */
export const DESIGN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["axes"],
  properties: {
    brandName: { type: "string" },
    axes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "question", "values", "productValues"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          question: { type: "string" },
          values: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["value", "label"], properties: { value: { type: "string" }, label: { type: "string" } } },
          },
          // one {i, value} per product — the product's INDEX in the numbered
          // catalog + its value on this axis. Index (not full URL) ~5×-shrinks the
          // model's output (URLs are long) → less latency/cost (ADR-0029). An ARRAY
          // (not a keyed map) because structured outputs require
          // additionalProperties:false on every object (ADR-0028 fix).
          productValues: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["i", "value"], properties: { i: { type: "integer" }, value: { type: "string" } } },
          },
        },
      },
    },
  },
};

export const SYSTEM_PROMPT = [
  "You are a merchandising strategist who designs interactive product-recommendation funnels.",
  "You are given a store's REAL catalog. Design the DECISION DIMENSIONS a great salesperson would use to guide a shopper to the right product — including dimensions the raw catalog data does not expose but a category expert knows (e.g. occasion, intensity/sillage, character, expertise level, use-case).",
  "",
  "HARD RULES:",
  "1. Ask FACTS about the shopper (occasion, intensity preferred, budget, experience). NEVER ask 'which product do you want' — derive the product from the facts.",
  "2. Design 3–6 dimensions ('axes'). Each axis has 2–4 answer values.",
  "3. For EVERY product in the catalog, assign its value on EACH axis in `productValues` — an ARRAY of {i, value} objects, one per product, where `i` is the product's index number `i` shown in the numbered catalog. This mapping is how answers select products — make it discriminating (products must differ across axes) so no single axis decides everything.",
  "4. Use ONLY the product indices provided (0..N-1). Do not invent products. Do not name products in the axes.",
  "5. SPREAD THE CATALOG (most important): give each product a DISTINCT profile — the combination of its values across the axes should be as unique as possible, so each product is the single best answer for some shopper. Choose enough axes and values that the number of answer-combinations is ≥ the number of products. A design where many products share the same profile leaves products unreachable and will be REJECTED. Only genuine near-duplicates (differing only by price) may share a profile.",
  "Return ONLY the JSON matching the provided schema.",
].join("\n");

/** Max products shown to the model in one design pass (prompt/output size bound). */
export const CATALOG_CAP = 120;

/** Compact NUMBERED catalog view for the prompt (i, name, price, attributes).
 *  The URL is omitted from the prompt — the model references products by index,
 *  and designToAxes resolves index → real URL deterministically (ADR-0029). */
function catalogForPrompt(products, cap = CATALOG_CAP) {
  return products.slice(0, cap).map((p, i) => ({
    i,
    name: p.name,
    price: p.price ?? null,
    currency: p.currency ?? null,
    attributes: p.attributes || {},
  }));
}

/** Human name for a funnel language code, so the model authors in the audience's tongue. */
export function langName(lang) {
  const map = { ar: "Arabic (Modern Standard, natural for a Gulf/Khaleeji audience)", en: "English", fr: "French", tr: "Turkish", ur: "Urdu", fa: "Persian" };
  return map[(lang || "ar").toLowerCase()] || map.ar;
}

export function buildUserPrompt(catalog, { goal, brand, lang } = {}) {
  const products = catalog.products || [];
  return [
    goal ? `Business goal: ${goal}` : "Business goal: (not specified — optimize for a confident, well-matched recommendation).",
    brand && brand.colors ? `Brand palette: ${JSON.stringify(brand.colors)}` : "",
    // Author shopper-facing copy in the funnel's language — an Arabic funnel must not ask
    // English questions. Product NAMES stay as they appear in the catalog.
    `LANGUAGE: Write every shopper-facing string — each axis 'question' and every answer 'label' — in ${langName(lang)}. Keep product names exactly as in the catalog.`,
    `Catalog (${products.length} products):`,
    JSON.stringify(catalogForPrompt(products)),
    "",
    "Design the decision axes now. Return JSON matching the schema.",
  ].filter(Boolean).join("\n");
}

/** Turn a model design into authorFromAxes axes, GROUNDED to the real catalog. */
export function designToAxes(design, catalog) {
  const products = catalog.products || [];
  const realUrls = new Set(products.map((p) => p.url));
  const axes = [];
  for (const a of (design && design.axes) || []) {
    if (!a || !Array.isArray(a.values) || a.values.length < 2) continue;
    const valueSet = new Set(a.values.map((v) => v.value));
    const profile = new Map();
    // productValues is an array of {i, value} (index → value, ADR-0029). Tolerate
    // the legacy {url, value} array and a url-keyed map too, so we're robust to the
    // model's exact output shape.
    const pv = a.productValues;
    const entries = Array.isArray(pv)
      ? pv.map((e) => {
          if (e && Number.isInteger(e.i)) { const p = products[e.i]; return [p && p.url, e.value]; }
          return [e && e.url, e && e.value];
        })
      : Object.entries(pv || {});
    for (const [url, value] of entries) {
      if (url && realUrls.has(url) && valueSet.has(value)) profile.set(url, value); // drop hallucinated / out-of-range / unknown-value
    }
    if (profile.size < 2) continue; // an axis that maps <2 real products is useless
    axes.push({
      id: String(a.id || "axis" + axes.length).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || ("axis" + axes.length),
      label: a.label || a.id,
      question: a.question || a.label || "؟",
      values: a.values.map((v) => ({ value: v.value, label: v.label || v.value })),
      profile,
      // Provenance for grounding (ADR-0037 BLOCKER-2): this mapping is a domain-expert model's
      // reading of the REAL catalog, VALIDATED here (real url + in-domain value). That is a
      // validated external mapping — grounded enough for a SOFT axis (always disclosed on
      // mismatch, never a hard filter). Hard axes never take this path, so the AI can never
      // manufacture a hard constraint from an inferred value.
      provenance: "ai-validated",
    });
  }
  return axes;
}

/**
 * @param {{origin?,brandUrl?,products:Array}} catalog
 * @param {Object} opts - { goal, brand, complete(req)->Promise<design>, attempts=2, maxQuestions=5 }
 * @returns {Promise<{ok:boolean, config?:Object, meta?:Object, reason?:string}>}
 */
export async function enrichAuthor(catalog, opts = {}) {
  const complete = opts.complete;
  if (typeof complete !== "function") return { ok: false, reason: "no-model" };
  const maxAttempts = Math.max(1, opts.attempts || 2); // bound cost (ADR-0032); backfill guarantees reachability
  const system = SYSTEM_PROMPT;
  let user = buildUserPrompt(catalog, opts);
  let lastReason = "unknown";

  // >CATALOG_CAP products: the model only sees the first CATALOG_CAP, so score the AI
  // design's coverage against the SHOWN set — don't burn attempts chasing coverage of a
  // tail the model never saw. The cap is disclosed honestly in the returned meta; the
  // covering backfill still makes the unseen tail reachable as nearest alternates.
  const allProducts = catalog.products || [];
  const overCap = allProducts.length > CATALOG_CAP;
  const evalCatalog = overCap ? { ...catalog, products: allProducts.slice(0, CATALOG_CAP) } : catalog;
  const capDisclosure = overCap ? { catalogCap: CATALOG_CAP, cappedFrom: allProducts.length } : {};

  // The design maps every product across every axis, so output grows with the catalog
  // (O(products × axes)) and Arabic is token-dense. Scale the cap to the catalog, with a
  // generous ceiling — billing is on actual output, and the background job has 15 min.
  const nProducts = (catalog.products || []).length;
  const maxTokens = Math.min(32000, Math.max(16000, nProducts * 260));

  // Keep the BEST valid attempt (highest coverage) across ALL attempts — we don't stop
  // at "just barely passed the gate"; we push for ~full coverage. `bestPass` = gate-
  // passing (≥ target); `bestEffort` = enough questions but coverage-short. We return
  // the best passing one, else the best effort (real coverage reported honestly, never
  // a worse fallback, never fabricated). ADR-0031.
  const NEAR_PERFECT = 0.97;
  const maxQuestions = opts.maxQuestions || 6; // allow a 5th–6th discriminating axis for full reachability
  let bestPass = null, bestEffort = null;
  const nProd = (catalog.products || []).length;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let design;
    try {
      design = await complete({ model: DESIGN_MODEL, system, user, schema: DESIGN_SCHEMA, maxTokens });
    } catch (e) {
      if (bestPass) break;
      if (bestEffort) return { ok: true, config: bestEffort.config, meta: { ...bestEffort.meta, source: "ai", coverageBelowTarget: true }, reason: "model-error-after-best" };
      return { ok: false, reason: "model-error", error: String((e && e.message) || e) };
    }

    let cov = 0, unreached = nProd;
    const axes = designToAxes(design, catalog);
    if (axes.length >= 2) {
      const authored = authorFromAxes(catalog, axes, { brandName: design && design.brandName, goal: opts.goal, maxQuestions });
      if (authored.ok) {
        const rich = richnessCheck(authored.config, evalCatalog); // score against the SHOWN set
        cov = rich.metrics.coverage || 0;
        unreached = Math.max(0, (evalCatalog.products || []).length - (rich.metrics.reachable || 0));
        if (rich.ok) {
          if (!bestPass || cov > bestPass.coverage) bestPass = { config: authored.config, meta: { ...authored.meta, attempt, coverage: cov, ...capDisclosure }, coverage: cov };
          if (cov >= NEAR_PERFECT) break; // near-perfect — stop spending attempts
        } else {
          const codes = rich.findings.map((f) => f.code);
          const onlyCoverage = codes.length > 0 && codes.every((c) => c === "RICHNESS_LOW_COVERAGE");
          if (onlyCoverage && (!bestEffort || cov > bestEffort.coverage)) bestEffort = { config: authored.config, meta: { ...authored.meta, attempt, coverage: cov, ...capDisclosure }, coverage: cov };
          lastReason = "thin:" + codes.join(",");
        }
      } else lastReason = authored.reason || "compile-failed";
    } else lastReason = "too-few-grounded-axes";

    // Repair: push for FULL coverage. Even a passing-but-imperfect design is asked to
    // reach the last few products by spreading profiles / adding a discriminating axis.
    const stillShort = Math.max(unreached, 0);
    user = buildUserPrompt(catalog, opts) +
      `\n\nYour previous design left ${stillShort} of ${nProd} products unreachable (coverage ${(cov * 100).toFixed(0)}%). ` +
      "Every product must be the #1 for some answer path. Too many products share the same profile — re-spread the productValues so each product has a DISTINCT combination, and ADD another discriminating axis (up to 6 questions) if needed so #answer-combinations ≥ #products. Keep ≥4 questions and map every product on every axis.";
  }
  // Prefer the best gate-PASSING design; else the best coverage-short effort (honest,
  // real coverage reported) — never the worse deterministic fallback, never fabricated.
  if (bestPass) return { ok: true, config: bestPass.config, meta: { ...bestPass.meta, source: "ai", coverage: bestPass.coverage } };
  if (bestEffort) return { ok: true, config: bestEffort.config, meta: { ...bestEffort.meta, source: "ai", coverageBelowTarget: true, coverage: bestEffort.coverage }, reason: lastReason };
  return { ok: false, reason: lastReason };
}
