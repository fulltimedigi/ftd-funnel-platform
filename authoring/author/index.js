/**
 * authoring/author/index.js — Author a funnel config from a real catalog (ADR-0015).
 * ---------------------------------------------------------------------------
 * Stage 2. catalog → a complete, trust-gate-passing decision-table `config`:
 *   - the top DISCRIMINATING axis (axes.js) becomes the primary question; its
 *     values become the results (archetypes), each anchored to a REAL product;
 *   - secondary axes become offer signals that refine the contextual products;
 *   - every recommendation is a real SKU with a real URL, and every reason is a
 *     plain, token-free sentence grounded in the user's choice (so it always
 *     resolves and passes engine/trustValidate.js by construction).
 *
 * Deterministic, dependency-free, Node-safe. NEVER invents a product or a claim:
 * if the catalog has no discriminating axis, it returns { ok:false } → the caller
 * falls back to a vertical template (no fabrication).
 */

import { deriveAxes } from "./axes.js";

const clamp = (s, n) => (String(s || "").length > n ? String(s).slice(0, n) : String(s || ""));
const slug = (s) => String(s || "funnel").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "funnel";
const fmtPrice = (p) => (p && p.price != null ? `${p.price}${p.currency ? " " + p.currency : ""}` : "");

/** Most complete product wins (priced + imaged + richer text); deterministic. */
function _bestProduct(list) {
  return [...list].sort((a, b) => {
    const sc = (p) => (p.price != null ? 2 : 0) + (p.image ? 1 : 0);
    return sc(b) - sc(a) || (b.description || "").length - (a.description || "").length || a.url.localeCompare(b.url);
  })[0];
}

/** Choose the primary axis (prefer type/category, then best-scored structured axis). */
function _pickPrimary(axes) {
  if (!axes.length) return null;
  const type = axes.find((a) => a.id === "type");
  if (type && type.values.length >= 2) return type;
  return axes[0];
}

/**
 * @param {{products:Array, origin?:string, brandUrl?:string}} catalog
 * @param {Object} [opts] - { brandName, theme, lang, sheetsEndpoint }
 * @returns {{ ok:boolean, reason?:string, config?:Object, meta?:Object }}
 */
export function authorFunnel(catalog, opts = {}) {
  const products = (catalog && catalog.products) || [];
  if (products.length < 3) return { ok: false, reason: "too-few-products", meta: { count: products.length } };

  const derived = deriveAxes(catalog, opts.axes);
  const primary = _pickPrimary(derived.axes);
  if (!primary) return { ok: false, reason: "no-discriminating-axis", meta: { axes: 0 } };

  const byUrl = new Map(products.map((p) => [p.url, p]));
  const secondaries = derived.axes.filter((a) => a.id !== primary.id && a.discrimination >= 0.3).slice(0, 2);
  // url -> value maps for each secondary axis (for contextual gating)
  const secMaps = secondaries.map((ax) => {
    const m = new Map();
    for (const v of ax.values) for (const u of v.productUrls) m.set(u, v.value);
    return { ax, m };
  });

  const brandName = opts.brandName || (catalog.origin ? new URL(catalog.origin).host.replace(/^www\./, "") : "المتجر");
  const lang = opts.lang || "ar";
  const theme = opts.theme || "platform-clean";
  const homeUrl = catalog.origin || catalog.brandUrl || (products[0] && new URL(products[0].url).origin) || "";

  /* ---- signals + questions ------------------------------------------------ */
  const primaryValues = primary.values;
  const sigPrimary = {
    id: "s_primary", role: "decision", required: true, source: "q_primary",
    domain: primaryValues.map((v) => v.value), map: {},
  };
  const qPrimary = {
    id: "q_primary", label: "السؤال الأول", text: `أي نوع من ${brandName} تبحث عنه؟`,
    options: primaryValues.map((v, i) => {
      const oid = `opt_p_${i}`;
      sigPrimary.map[oid] = v.value;
      return { id: oid, label: clamp(v.label || v.value, 60) };
    }),
  };

  const signals = [sigPrimary];
  const questions = [qPrimary];
  secMaps.forEach(({ ax }, si) => {
    const sig = { id: `s_sec_${si}`, role: "offer", required: false, default: ax.values[0].value, source: `q_sec_${si}`, domain: ax.values.map((v) => v.value), map: {} };
    const q = {
      id: `q_sec_${si}`, label: `السؤال ${si + 2}`, text: _secQuestionText(ax),
      options: ax.values.map((v, i) => { const oid = `opt_s${si}_${i}`; sig.map[oid] = v.value; return { id: oid, label: clamp(v.label || v.value, 60) }; }),
    };
    signals.push(sig); questions.push(q);
  });

  const derivedSignals = [{ id: "D_primary", from: ["s_primary"], rule: "identity", domain: primaryValues.map((v) => v.value) }];

  /* ---- archetypes (one per primary value), each anchored to a real product - */
  const archetypes = [];
  const table = [];
  let biggest = { id: null, count: -1 };
  primaryValues.forEach((v, i) => {
    const group = v.productUrls.map((u) => byUrl.get(u)).filter(Boolean);
    if (group.length === 0) return;
    const id = `R${i + 1}`;
    const hero = _bestProduct(group);
    if (group.length > biggest.count) biggest = { id, count: group.length };

    // contextual: for each secondary axis value present in the group, the best matching product
    const contextual = [];
    secMaps.forEach(({ m }, si) => {
      const seen = new Set();
      for (const p of group) {
        const val = m.get(p.url);
        if (!val || seen.has(val) || p.url === hero.url) continue;
        seen.add(val);
        contextual.push({
          name: clamp(p.name, 120), url: p.url, price: fmtPrice(p),
          needs: { [`s_sec_${si}`]: val },
          becauseTemplate: `خيار «${clamp(p.name, 80)}» يناسب تفضيلك ضمن فئة «${clamp(v.label || v.value, 60)}».`,
        });
      }
    });

    archetypes.push({
      id, name: clamp(v.label || v.value, 80), icon: "✨",
      description: `توصيتنا ضمن فئة «${clamp(v.label || v.value, 60)}» من ${brandName}.`,
      recommendations: {
        primary: {
          name: clamp(hero.name, 120), url: hero.url, price: fmtPrice(hero),
          becauseTemplate: `اخترت فئة «${clamp(v.label || v.value, 60)}»، و«${clamp(hero.name, 80)}» هو اختيارنا الأنسب فيها من ${brandName}.`,
        },
        ...(contextual.length ? { contextual: contextual.slice(0, 4) } : {}),
      },
      resultExtras: {
        why: [{ needs: {}, claim: `«${clamp(hero.name, 80)}» يمثّل فئة «${clamp(v.label || v.value, 60)}» التي اخترتها.` }],
        nextAction: `تصفّح «${clamp(hero.name, 80)}» وأكمل طلبك.`,
      },
    });
    table.push({ id: `r_${id}`, when: { D_primary: v.value }, result: id });
  });

  if (archetypes.length < 2) return { ok: false, reason: "insufficient-groups", meta: { groups: archetypes.length } };
  // Totality: the safety default reuses the largest group's archetype (no dead end, no extra unreachable archetype).
  table.push({ id: "r_default", when: {}, result: biggest.id });

  const config = {
    _generatedBy: "ftd-authoring/stage2",
    id: slug(brandName) + "-advisor",
    brand: { name: brandName, logo: "", tagline: `مرشدك لاختيار المنتج الأنسب من ${brandName}` },
    theme, lang,
    hero: {
      eyebrow: `${questions.length} أسئلة · نتيجة فورية`,
      headline: `محتار تختار من ${brandName}؟`,
      subtext: "جاوب على أسئلة سريعة ونوصّلك للمنتج الأنسب لك — مع سبب واضح.",
      chips: [`${questions.length} أسئلة`, "منتجات حقيقية", "سبب لكل توصية"],
      startLabel: "ابدأ الآن ←",
    },
    scoring: { mode: "decision-table" },
    signals, derivedSignals, decisionTable: table,
    resultLayout: "commerce",
    archetypes,
    questions,
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

  return { ok: true, config, meta: { primaryAxis: primary.id, secondaryAxes: secondaries.map((a) => a.id), archetypes: archetypes.length } };
}

function _secQuestionText(ax) {
  if (ax.id === "price") return "ما ميزانيتك التقريبية؟";
  if (ax.id === "type") return "أي فئة تفضّل؟";
  if (ax.id === "brand") return "هل تفضّل علامة معيّنة؟";
  return `ما تفضيلك في: ${ax.label}؟`;
}
