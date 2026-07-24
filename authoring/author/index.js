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
import { richnessCheck } from "../quality/richnessCheck.js";

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

/**
 * Covering assignment (ADR-0031) — "Results First". Every product OWNS the answer-
 * combination that matches its own axis-profile, so it is the #1 result for at least
 * that path; no product is orphaned. Genuine profile-twins share that leaf ranked
 * (#1 + nearest alternates). Combos that are no product's home are filled by best
 * match (routing to an already-reachable product).
 * @returns {{winnerByCombo:Map<string,Object>, altByUrl:Map<string,Object[]>}}
 */
function _assignCovering(products, axisSet, combos, overall) {
  const key = (c) => c.join("¦");
  const val = (p, a) => a.profile.get(p.url);
  const isFull = (p) => axisSet.every((a) => val(p, a) != null);
  const score = (p, combo) => {
    let s = 0;
    axisSet.forEach((a, i) => { const pv = val(p, a); if (pv != null) s += pv === combo[i] ? 1 : -0.001; });
    return s;
  };

  // Each product's HOME combo: its exact profile (full) or its best-matching combo (partial).
  const contenders = new Map(); // comboKey -> [products whose home is this combo]
  for (const p of products) {
    let home;
    if (isFull(p)) {
      home = axisSet.map((a) => val(p, a));
    } else {
      let best = combos[0], bs = -Infinity;
      for (const c of combos) { const s = score(p, c); if (s > bs) { bs = s; best = c; } }
      home = best;
    }
    const k = key(home);
    if (!contenders.has(k)) contenders.set(k, []);
    contenders.get(k).push(p);
  }
  for (const list of contenders.values()) list.sort((a, b) => (_bestProduct([a, b]) === a ? -1 : 1));

  const winnerByCombo = new Map();
  const altByUrl = new Map();
  const reached = new Set(); // product urls that are the #1 for some combo

  // Pass 1 — every product OWNS the combo matching its own profile (primary), twins ranked.
  for (const combo of combos) {
    const k = key(combo);
    if (!contenders.has(k)) continue;
    const list = contenders.get(k);
    const primary = list[0];
    winnerByCombo.set(k, primary);
    reached.add(primary.url);
    if (list.length > 1) altByUrl.set(primary.url, list.slice(1));
  }

  // Pass 2 — fill the remaining (home-less) combos. Among the products that match the
  // combo BEST (top score — honest, never a poor match), PREFER one that is not yet any
  // shopper's #1, so genuine profile-twins each get their own answer path where the
  // answer-space allows. Coverage → ~100% when #combos ≥ #distinct-needs. No fabrication.
  for (const combo of combos) {
    const k = key(combo);
    if (winnerByCombo.has(k)) continue;
    let bs = -Infinity;
    for (const p of products) { const s = score(p, combo); if (s > bs) bs = s; }
    const top = products.filter((p) => score(p, combo) === bs);
    const fresh = top.filter((p) => !reached.has(p.url));
    const primary = (fresh.length ? _bestProduct(fresh) : _bestProduct(top)) || overall;
    winnerByCombo.set(k, primary);
    reached.add(primary.url);
  }
  return { winnerByCombo, altByUrl };
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

  // 1. COVERING assignment (ADR-0031): every product owns the combo matching its own
  //    profile → no product is orphaned. "Results First, Questions Last."
  const combos = cartesian(axisSet.map((a) => a.values.map((v) => v.value)));
  const overall = _bestProduct(products);
  const { winnerByCombo, altByUrl } = _assignCovering(products, axisSet, combos, overall);
  const winners = new Map(); // url -> product (distinct combo winners)
  for (const p of winnerByCombo.values()) if (!winners.has(p.url)) winners.set(p.url, p);

  // 2. archetypes = the winning real products, each with up to 3 REAL nearest
  //    alternates (profile-twins) so every product is reachable and each result shows
  //    "قد يناسبك أيضاً" — a clear #1 + alternates, never a catalog dump.
  const ALT_CAP = 3;
  const archId = new Map();
  const archetypes = [];
  [...winners.values()].forEach((p, i) => {
    const id = `R${i + 1}`;
    archId.set(p.url, id);
    // which axis values does this product carry (for answer-grounded why bullets)
    const carries = axisSet.map((a) => ({ D: `D_${a.id}`, label: a.label, value: a.profile.get(p.url) })).filter((x) => x.value != null);
    const why = [{ needs: {}, claim: `«${clamp(p.name, 70)}» يطابق ما اخترته من ${axisSet.map((a) => a.label).join(" و")}.` }];
    for (const c of carries) why.push({ needs: { [c.D]: c.value }, claim: `اخترت ${c.label}، و«${clamp(p.name, 60)}» يوفّرها.` });
    // Carry the REAL product image through (ADR-0033) — image + price + reason make the
    // premium card. Only a real catalog image; a missing one renders a tasteful placeholder.
    const contextual = (altByUrl.get(p.url) || []).slice(0, ALT_CAP).map((q) => ({ name: clamp(q.name, 120), url: q.url, price: fmtPrice(q), image: q.image || "" }));
    archetypes.push({
      id, name: clamp(p.name, 80), icon: "✨", image: p.image || "",
      description: `اختيارنا الأنسب من ${brandName} بناءً على إجاباتك.`,
      recommendations: {
        primary: {
          name: clamp(p.name, 120), url: p.url, price: fmtPrice(p), image: p.image || "",
          becauseTemplate: `«${clamp(p.name, 80)}» هو الأنسب لأنه يجمع ما تبحث عنه من ${axisSet.map((a) => a.label).join(" و")} في ${brandName}.`,
        },
        ...(contextual.length ? { contextual } : {}),
      },
      resultExtras: {
        why,
        whyNot: [{ name: "عن البدائل", needs: {}, claim: `«${clamp(p.name, 70)}» يجمع معاييرك معًا (${axisSet.map((a) => a.label).join(" + ")})، بينما البدائل تحقّق جزءًا منها فقط.` }],
        nextAction: `تصفّح «${clamp(p.name, 70)}» وأكمل طلبك.`,
      },
    });
  });

  // 2b. COVERAGE BACKFILL (ADR-0031): guarantee EVERY product is reachable. Any product
  //     that the answer-space couldn't give a distinct #1 (a genuine near-duplicate) is
  //     attached to the archetype it best matches, as a real nearest alternate. Honest:
  //     it only ever adds a real product to the result it most closely fits; the #1 of
  //     each result is unchanged. Common results keep ≤3 alternates; only the few
  //     over-subscribed profiles carry the extras — the ranked-list leaf the spec allows.
  const present = new Set();
  for (const a of archetypes) { present.add(a.recommendations.primary.url); for (const c of a.recommendations.contextual || []) present.add(c.url); }
  const simTo = (p, ap) => axisSet.reduce((s, ax) => s + (ax.profile.get(p.url) != null && ax.profile.get(p.url) === ax.profile.get(ap.url) ? 1 : 0), 0);
  for (const p of products) {
    if (present.has(p.url)) continue;
    let bestA = null, bs = -Infinity;
    for (const a of archetypes) { const ap = winners.get(a.recommendations.primary.url); const s = simTo(p, ap); if (s > bs) { bs = s; bestA = a; } }
    if (bestA) {
      const rc = bestA.recommendations;
      (rc.contextual || (rc.contextual = [])).push({ name: clamp(p.name, 120), url: p.url, price: fmtPrice(p), image: p.image || "" });
      present.add(p.url);
    }
  }

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
    theme: opts.theme || "platform-premium", lang: opts.lang || "ar",
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
  // Among trust+bland-passing axis-sets, choose the one with the HIGHEST catalog
  // COVERAGE (ADR-0031) — "Results First": we want the arrangement that makes the most
  // of the store reachable, not merely the first that passes. Larger sets first (depth),
  // ties broken by coverage then depth.
  let best = null;
  for (let size = maxSize; size >= 2; size--) {
    for (const set of _combos(usable, size, 24)) {
      const combos = set.reduce((n, a) => n * a.values.length, 1);
      if (combos > maxCombos) continue;
      const config = buildConfig(cleanCat, set, opts);
      const trust = trustValidate(config);
      const bland = antiBlandCheck(config);
      attempts.push({ axes: set.map((a) => a.id), size, trust: trust.ok, bland: bland.ok });
      if (trust.ok && bland.ok) {
        const rich = richnessCheck(config, cleanCat);
        const cand = { config, coverage: rich.metrics.coverage, richOk: rich.ok, size,
          meta: { axes: set.map((a) => a.id), questions: set.length, archetypes: config.archetypes.length, combos, coverage: rich.metrics.coverage } };
        if (!best || cand.coverage > best.coverage + 1e-9 || (Math.abs(cand.coverage - best.coverage) <= 1e-9 && cand.size > best.size)) best = cand;
        // A set that both passes richness AND covers ~everything is optimal — stop early.
        if (rich.ok && rich.metrics.coverage >= 0.999) break;
      }
    }
    if (best && best.richOk && best.coverage >= 0.999) break;
  }
  if (best) return { ok: true, config: best.config, meta: best.meta };
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
