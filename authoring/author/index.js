/**
 * authoring/author/index.js — Author a funnel config from a real catalog (ADR-0015/0017).
 * ---------------------------------------------------------------------------
 * Stage 2. catalog → a complete config that passes ALL gates: schema, the trust
 * gate, AND the anti-bland gate (ADR-0016). The funnel asks FACTS (budget, style,
 * use) and DERIVES the product from the COMBINATION of ≥2 signals — never a mirror
 * question, never a single-question-dominant one (docs/standards/funnel-quality-
 * anti-bland-standard-v1.md).
 *
 * How: pick ≥2 discriminating fact axes; each product has a value on each axis; the
 * decision table maps every fact-combination to the REAL product that best matches
 * it. Because the result depends on the combination, no single answer determines it.
 * The gate is run in a reject-and-regenerate loop over axis-sets — if no set yields
 * a non-bland funnel, authoring is REFUSED (honest; use a template — no fabrication).
 *
 * Deterministic, dependency-free, Node-safe.
 */

import { deriveAxes, cleanCatalog } from "./axes.js";
import { trustValidate } from "../../engine/trustValidate.js";
import { antiBlandCheck } from "./qualityGate.js";

const clamp = (s, n) => (String(s || "").length > n ? String(s).slice(0, n) : String(s || ""));
const slug = (s) => String(s || "funnel").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "funnel";
const fmtPrice = (p) => (p && p.price != null ? `${p.price}${p.currency ? " " + p.currency : ""}` : "");
const cartesian = (arrs) => arrs.reduce((acc, arr) => acc.flatMap((a) => arr.map((b) => [...a, b])), [[]]);

function _bestProduct(list) {
  return [...list].sort((a, b) => {
    const sc = (p) => (p.price != null ? 2 : 0) + (p.image ? 1 : 0);
    return sc(b) - sc(a) || (b.description || "").length - (a.description || "").length || a.url.localeCompare(b.url);
  })[0];
}

/* ---- fact axes (categorical, fact-framed, ≤4 values each) ------------------ */

function _priceLabel(v) {
  const m = { budget: "اقتصادي", mid: "متوسط", premium: "مميّز" };
  return m[v.value] || v.value;
}

const _FACET_Q = ["أي طابع تفضّل؟", "ما التفضيل الأقرب لك؟", "أي فئة تناسبك أكثر؟"];

function buildFactAxes(products) {
  const d = deriveAxes({ products });
  const axes = [];

  const price = d.axes.find((a) => a.id === "price");
  if (price && price.values.length >= 2) {
    const profile = new Map();
    price.values.forEach((v) => v.productUrls.forEach((u) => profile.set(u, v.value)));
    axes.push({ id: "budget", label: "الميزانية", question: "ما ميزانيتك التقريبية؟", values: price.values.map((v) => ({ value: v.value, label: _priceLabel(v) })), profile });
  }

  // name-mined mutually-exclusive facet axes (form / origin / size), clustered by
  // co-occurrence in axes.js — each already carries a url→value profile.
  for (const fa of d.axes.filter((a) => String(a.id).startsWith("facet"))) {
    axes.push({ id: fa.id, label: "الطابع", question: _FACET_Q[axes.length % _FACET_Q.length], values: fa.values.map((v) => ({ value: v.value, label: v.value })), profile: fa.profile });
  }

  const type = d.axes.find((a) => a.id === "type");
  if (type && type.values.length >= 2 && type.values.length <= 6) {
    const profile = new Map();
    type.values.forEach((v) => v.productUrls.forEach((u) => profile.set(u, v.value)));
    axes.push({ id: "usetype", label: "الفئة", question: "لأي نوع استخدام تبحث؟", values: type.values.map((v) => ({ value: v.value, label: v.value })), profile });
  }

  return axes;
}

/* ---- build a config from a chosen set of fact axes (matching) -------------- */

function buildConfig(catalog, axisSet, opts) {
  const products = catalog.products;
  const brandName = opts.brandName || (catalog.origin ? new URL(catalog.origin).host.replace(/^www\./, "") : "المتجر");
  const homeUrl = catalog.origin || catalog.brandUrl || (products[0] && new URL(products[0].url).origin) || "";

  // 1. match every fact-combination to the best real product
  const combos = cartesian(axisSet.map((a) => a.values.map((v) => v.value)));
  const overall = _bestProduct(products);
  const winnerByCombo = new Map();
  const winners = new Map(); // url -> product
  for (const combo of combos) {
    let best = null, bestScore = -2;
    for (const p of products) {
      let score = 0;
      axisSet.forEach((a, i) => { const pv = a.profile.get(p.url); if (pv != null) score += pv === combo[i] ? 1 : -0.001; });
      const better = score > bestScore || (score === bestScore && best && _bestProduct([p, best]) === p);
      if (better) { best = p; bestScore = score; }
    }
    best = best || overall;
    winnerByCombo.set(combo.join("¦"), best);
    winners.set(best.url, best);
  }

  // 2. archetypes = the winning real products
  const archId = new Map();
  const archetypes = [];
  [...winners.values()].forEach((p, i) => {
    const id = `R${i + 1}`;
    archId.set(p.url, id);
    // which axis values does this product carry (for answer-grounded why bullets)
    const carries = axisSet.map((a) => ({ D: `D_${a.id}`, label: a.label, value: a.profile.get(p.url) })).filter((x) => x.value != null);
    const why = [{ needs: {}, claim: `«${clamp(p.name, 70)}» يطابق ما اخترته من ${axisSet.map((a) => a.label).join(" و")}.` }];
    for (const c of carries) why.push({ needs: { [c.D]: c.value }, claim: `اخترت ${c.label}، و«${clamp(p.name, 60)}» يوفّرها.` });
    archetypes.push({
      id, name: clamp(p.name, 80), icon: "✨",
      description: `اختيارنا الأنسب من ${brandName} بناءً على إجاباتك.`,
      recommendations: {
        primary: {
          name: clamp(p.name, 120), url: p.url, price: fmtPrice(p),
          becauseTemplate: `«${clamp(p.name, 80)}» هو الأنسب لأنه يجمع ما تبحث عنه من ${axisSet.map((a) => a.label).join(" و")} في ${brandName}.`,
        },
      },
      resultExtras: {
        why,
        whyNot: [{ name: "عن البدائل", needs: {}, claim: `«${clamp(p.name, 70)}» يجمع معاييرك معًا (${axisSet.map((a) => a.label).join(" + ")})، بينما البدائل تحقّق جزءًا منها فقط.` }],
        nextAction: `تصفّح «${clamp(p.name, 70)}» وأكمل طلبك.`,
      },
    });
  });

  // 3. signals + derived signals + questions
  const signals = [], derivedSignals = [], questions = [];
  axisSet.forEach((a, ai) => {
    const sid = `s_${a.id}`, qid = `q_${a.id}`;
    const sig = { id: sid, role: "decision", required: true, source: qid, domain: a.values.map((v) => v.value), map: {} };
    const q = { id: qid, label: `السؤال ${ai + 1}`, text: a.question, options: a.values.map((v, i) => { const oid = `opt_${a.id}_${i}`; sig.map[oid] = v.value; return { id: oid, label: clamp(v.label, 60) }; }) };
    signals.push(sig); questions.push(q);
    derivedSignals.push({ id: `D_${a.id}`, from: [sid], rule: "identity", domain: a.values.map((v) => v.value) });
  });

  // 4. decision table: one rule per combo → winner archetype; default → overall best
  const decisionTable = combos.map((combo, ci) => ({
    id: `r_${ci}`,
    when: Object.fromEntries(axisSet.map((a, i) => [`D_${a.id}`, combo[i]])),
    result: archId.get(winnerByCombo.get(combo.join("¦")).url),
  }));
  decisionTable.push({ id: "r_default", when: {}, result: archId.get(overall.url) || archetypes[0].id });

  return {
    _generatedBy: "ftd-authoring/stage2",
    id: slug(brandName) + "-advisor",
    brand: { name: brandName, logo: "", tagline: `مرشدك لاختيار المنتج الأنسب من ${brandName}` },
    theme: opts.theme || "platform-clean", lang: opts.lang || "ar",
    hero: {
      eyebrow: `${questions.length} أسئلة · نتيجة فورية`,
      headline: `محتار تختار من ${brandName}؟`,
      subtext: "جاوب على أسئلة سريعة عن احتياجك ونستنتج لك المنتج الأنسب — مع سبب واضح.",
      chips: [`${questions.length} أسئلة`, "منتجات حقيقية", "سبب لكل توصية"],
      startLabel: "ابدأ الآن ←",
    },
    scoring: { mode: "decision-table" },
    signals, derivedSignals, decisionTable,
    resultLayout: "commerce",
    decisiveResult: true, // UX_INTERFACE_DECISION §6: one pick + 2–3 reasons + one CTA
    archetypes, questions,
    leadForm: {
      gated: true, skippable: true,
      fields: [
        { name: "name", label: "الاسم", type: "text", required: true },
        { name: "email", label: "البريد الإلكتروني", type: "email", required: true },
        { name: "phone", label: "رقم الجوال (اختياري)", type: "tel", required: false },
      ],
      privacyNote: "🔒 بياناتك آمنة ولن تُشارك.",
      submitLabel: "اعرض توصيتي ✦",
    },
    cta: { primaryLabel: `تسوّق من ${brandName} ←`, primaryUrl: homeUrl || "https://example.com", utm: "" },
    analytics: { sinks: ["sheets"], sheetsEndpoint: opts.sheetsEndpoint || "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE" },
    copy: {
      loaderText: "نحلّل إجاباتك…",
      progressLabels: questions.map((q) => q.label),
      restartLabel: "↺ ابدأ من جديد",
      result: { eyebrow: "توصيتك", recommendationTitle: "نوصيك بـ", whyTitle: "لماذا تناسبك", whyNotTitle: "لماذا ليست البدائل", nextTitle: "الخطوة التالية", contextualTitle: "قد يناسبك أيضاً" },
    },
  };
}

/* ---- orchestrator: reject-and-regenerate over axis-sets until a gate-passing,
       non-bland funnel is found (or refuse honestly) ------------------------- */

function _axisSets(axes) {
  const sets = [];
  for (let i = 0; i < axes.length; i++) for (let j = i + 1; j < axes.length; j++) sets.push([axes[i], axes[j]]); // pairs
  for (let i = 0; i < axes.length; i++) for (let j = i + 1; j < axes.length; j++) for (let k = j + 1; k < axes.length; k++) sets.push([axes[i], axes[j], axes[k]]); // triples
  return sets;
}

/* Combinations of `arr` of size `k` (bounded by `cap` results). */
function _combos(arr, k, cap) {
  const out = [];
  const rec = (start, acc) => {
    if (out.length >= cap) return;
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}

/**
 * Author a funnel from EXTERNALLY-SUPPLIED axes (ADR-0028, Track C). Same
 * gate-passing `buildConfig` machinery as authorFunnel, but the axes come from
 * grounded AI enrichment (rich category dimensions the catalog didn't expose),
 * each carrying a `profile` Map(productUrl → value). Searches LARGEST axis-sets
 * first so it maximizes question depth (richness) while staying within a combo
 * budget, and only returns a set that passes BOTH gates. Never fabricates: every
 * recommendation is chosen by buildConfig from the real catalog.
 * @param {{origin?,brandUrl?,products:Array}} catalog
 * @param {Array<{id,label,question,values:Array,profile:Map}>} axes
 */
export function authorFromAxes(catalog, axes, opts = {}) {
  const products = cleanCatalog((catalog && catalog.products) || []);
  if (products.length < 4) return { ok: false, reason: "too-few-products", meta: { count: products.length } };
  const cleanCat = { ...catalog, products };

  const usable = (axes || []).filter((a) => a && a.values && a.values.length >= 2 && a.profile && a.profile.size);
  if (usable.length < 2) return { ok: false, reason: "not-enough-axes", meta: { axes: usable.length } };

  const maxCombos = opts.maxCombos || 200;
  const maxSize = Math.min(usable.length, opts.maxQuestions || 5);
  const attempts = [];
  for (let size = maxSize; size >= 2; size--) {
    for (const set of _combos(usable, size, 24)) {
      const combos = set.reduce((n, a) => n * a.values.length, 1);
      if (combos > maxCombos) continue;
      const config = buildConfig(cleanCat, set, opts);
      const trust = trustValidate(config);
      const bland = antiBlandCheck(config);
      attempts.push({ axes: set.map((a) => a.id), size, trust: trust.ok, bland: bland.ok });
      if (trust.ok && bland.ok) {
        return { ok: true, config, meta: { axes: set.map((a) => a.id), questions: set.length, archetypes: config.archetypes.length, combos } };
      }
    }
  }
  return { ok: false, reason: "no-gatepassing-axis-set", meta: { attempts } };
}

export function authorFunnel(catalog, opts = {}) {
  const products = cleanCatalog((catalog && catalog.products) || []);
  if (products.length < 4) return { ok: false, reason: "too-few-products", meta: { count: products.length } };
  const cleanCat = { ...catalog, products };

  const axes = buildFactAxes(products);
  if (axes.length < 2) return { ok: false, reason: "not-enough-fact-axes", meta: { factAxes: axes.length } };

  const attempts = [];
  for (const set of _axisSets(axes)) {
    // keep the swept signal-space bounded
    const combos = set.reduce((n, a) => n * a.values.length, 1);
    if (combos > 64) continue;
    const config = buildConfig(cleanCat, set, opts);
    const trust = trustValidate(config);
    const bland = antiBlandCheck(config);
    attempts.push({ set: set.map((a) => a.id), trust: trust.ok, bland: bland.ok, blandFindings: bland.findings.map((f) => f.code) });
    if (trust.ok && bland.ok) {
      return { ok: true, config, meta: { axes: set.map((a) => a.id), archetypes: config.archetypes.length, combos } };
    }
  }
  return { ok: false, reason: "no-nonbland-funnel", meta: { triedAxes: axes.map((a) => a.id), attempts } };
}
