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
import { deriveFormatAxis, looksLikeFormatAxis } from "./formatAxis.js";
import { deriveBudgetAxis, looksLikeBudgetAxis } from "./budgetAxis.js";

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
const SOFT_MISS = -0.5; // a soft-axis mismatch is a real cost (ADR-0034), not near-free

/**
 * Covering assignment with an ORDERED CONSTRAINT LADDER (ADR-0036, "the Promise Principle").
 * Hard axes are RANKED by their order in axisSet (rank-1 first). For every combo we require
 * ALL hard ranks; if no product matches, we drop the LOWEST-rank hard axis and retry, until
 * ≥1 product appears. Rank-1 NEVER drops (its values always have products → no dead-end), so
 * we never silently fall to a product that ignores the shopper's top promise. Whatever ranks
 * were dropped are recorded per combo in `relaxedByCombo` and surfaced honestly on the rule.
 */
function _assignCovering(products, axisSet, combos, overall) {
  const key = (c) => c.join("¦");
  const val = (p, a) => a.profile.get(p.url);
  const isFull = (p) => axisSet.every((a) => val(p, a) != null);
  const hardIdx = axisSet.map((a, i) => (a.hard ? i : -1)).filter((i) => i >= 0); // rank order
  const softIdx = axisSet.map((a, i) => (a.hard ? -1 : i)).filter((i) => i >= 0);
  const ordRank = new Map(hardIdx.filter((i) => axisSet[i].ordinal).map((i) => [i, new Map(axisSet[i].values.map((v, k) => [v.value, k]))]));

  const matchesHard = (p, combo, active) => {
    for (const i of active) { const pv = val(p, axisSet[i]); if (pv != null && pv !== combo[i]) return false; }
    return true; // null value = wildcard (eligible), so nothing is orphaned
  };
  const softScore = (p, combo) => { let s = 0; for (const i of softIdx) { const pv = val(p, axisSet[i]); if (pv != null) s += pv === combo[i] ? 1 : SOFT_MISS; } return s; };
  // Within a (possibly relaxed) pool: prefer NEAREST on any relaxed ordinal axis (so a
  // relaxed price is honestly the closest), then the best soft match.
  const selScore = (p, combo, relaxed) => {
    let s = softScore(p, combo);
    for (const i of relaxed) { const rk = ordRank.get(i); if (rk) { const pv = val(p, axisSet[i]); if (pv != null) s -= 10 * Math.abs((rk.get(pv) ?? 0) - (rk.get(combo[i]) ?? 0)); } }
    return s;
  };
  const poolFor = (combo) => {
    const active = hardIdx.slice();
    const relaxed = [];
    for (;;) {
      const pool = products.filter((p) => matchesHard(p, combo, active));
      if (pool.length || active.length <= 1) return { pool, relaxed };
      relaxed.push(active.pop()); // drop the LOWEST-rank hard axis; rank-1 (index 0) never drops
    }
  };

  // Pass 1 — full products own their exact home combo (all ranks satisfied → no relaxation).
  const contenders = new Map();
  for (const p of products) { if (!isFull(p)) continue; const k = key(axisSet.map((a) => val(p, a))); if (!contenders.has(k)) contenders.set(k, []); contenders.get(k).push(p); }
  for (const list of contenders.values()) list.sort((a, b) => (_bestProduct([a, b]) === a ? -1 : 1));

  const winnerByCombo = new Map(), altByUrl = new Map(), relaxedByCombo = new Map(), reached = new Set();
  for (const combo of combos) {
    const k = key(combo);
    if (!contenders.has(k)) continue;
    const list = contenders.get(k);
    winnerByCombo.set(k, list[0]); reached.add(list[0].url); relaxedByCombo.set(k, []);
    if (list.length > 1) altByUrl.set(list[0].url, list.slice(1));
  }

  // Pass 2 — fill via the ladder. The winner always respects rank-1; any dropped ranks are
  // recorded. Prefer a not-yet-#1 product among the top (keeps coverage ~100% within cells).
  for (const combo of combos) {
    const k = key(combo);
    if (winnerByCombo.has(k)) continue;
    const { pool, relaxed } = poolFor(combo);
    const cands = pool.length ? pool : (overall ? [overall] : products.slice(0, 1));
    let bs = -Infinity;
    for (const p of cands) { const s = selScore(p, combo, relaxed); if (s > bs) bs = s; }
    const top = cands.filter((p) => selScore(p, combo, relaxed) === bs);
    const fresh = top.filter((p) => !reached.has(p.url));
    const winner = (fresh.length ? _bestProduct(fresh) : _bestProduct(top)) || overall;
    winnerByCombo.set(k, winner); reached.add(winner.url);
    relaxedByCombo.set(k, relaxed.map((i) => axisSet[i]));
  }
  return { winnerByCombo, altByUrl, relaxedByCombo };
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
  const { winnerByCombo, altByUrl, relaxedByCombo } = _assignCovering(products, axisSet, combos, overall);
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
  // HARD-aware similarity (ADR-0034/0035): an orphan attaches only to a SAME strict-hard
  // (e.g. same FORMAT) archetype (mismatch → -Infinity); for an ordinal hard axis (budget)
  // it prefers the same tier, nearest otherwise; soft matches rank among those.
  const _rank = (ax, v) => ax.values.findIndex((x) => x.value === v);
  const simTo = (p, ap) => {
    let s = 0;
    for (const ax of axisSet) {
      const pv = ax.profile.get(p.url), apv = ax.profile.get(ap.url);
      if (ax.hard && ax.ordinal) { if (pv != null && apv != null) s -= 10 * Math.abs(_rank(ax, pv) - _rank(ax, apv)); } // prefer same tier, nearest otherwise
      else if (ax.hard) { if (pv != null && apv != null && pv !== apv) return -Infinity; } // strict hard: same value only
      else if (pv != null && pv === apv) s += 1;
    }
    return s;
  };
  for (const p of products) {
    if (present.has(p.url)) continue;
    let bestA = null, bs = -Infinity;
    for (const a of archetypes) { const ap = winners.get(a.recommendations.primary.url); const s = simTo(p, ap); if (s > bs) { bs = s; bestA = a; } }
    if (bestA && bs > -Infinity) {
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

  // 4. decision table: one rule per combo → winner archetype. RULE-LEVEL HONESTY (ADR-0036):
  //    if the ladder relaxed any ranked constraint for this combo (the exact cell was empty),
  //    the rule carries `relaxed:[{axis,label,dir?}]` so the result can say so — never silent.
  const axisPos = new Map(axisSet.map((a, i) => [a, i]));
  const relaxedFor = (combo) => {
    const winner = winnerByCombo.get(combo.join("¦"));
    const out = [];
    const seen = new Set();
    const dirFor = (a) => {
      const wv = a.profile.get(winner.url);
      const wi = a.values.findIndex((v) => v.value === wv), ci = a.values.findIndex((v) => v.value === combo[axisPos.get(a)]);
      return (wi >= 0 && ci >= 0 && wi !== ci) ? (wi > ci ? "above" : "below") : undefined;
    };
    // 1) HARD ranks the ladder had to relax (the exact cell was empty).
    for (const a of relaxedByCombo.get(combo.join("¦")) || []) {
      const o = { axis: a.id, label: a.label }; if (a.ordinal) { const d = dirFor(a); if (d) o.dir = d; }
      out.push(o); seen.add(a.id);
    }
    // 2) SOFT axes the scorer couldn't fully honour — disclosed too (no silent override).
    for (const a of axisSet) {
      if (a.hard || seen.has(a.id)) continue;
      const wv = a.profile.get(winner.url), cv = combo[axisPos.get(a)];
      if (wv != null && wv !== cv) { const o = { axis: a.id, label: a.label, soft: true }; if (a.ordinal) { const d = dirFor(a); if (d) o.dir = d; } out.push(o); }
    }
    return out;
  };
  const decisionTable = combos.map((combo, ci) => {
    const rule = {
      id: `r_${ci}`,
      when: Object.fromEntries(axisSet.map((a, i) => [`D_${a.id}`, combo[i]])),
      result: archId.get(winnerByCombo.get(combo.join("¦")).url),
    };
    const relaxed = relaxedFor(combo);
    if (relaxed.length) rule.relaxed = relaxed;
    return rule;
  });
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
    // The ordered constraint ladder (ADR-0036): hard axis ids, rank-1 first. rank-1 never
    // relaxes; lower ranks relax only into a `relaxed` disclosure on the rule.
    constraintLadder: axisSet.filter((a) => a.hard).map((a) => a.id),
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

/** Drop an axis whose value-domain heavily overlaps an already-kept one (the deterministic
 *  miner sometimes derives the same dimension twice, e.g. name-facet AND attributes.type). */
function _dedupeAxes(axes) {
  const kept = [];
  for (const a of axes) {
    const av = new Set(a.values.map((v) => String(v.value).toLowerCase()));
    const dup = kept.some((k) => {
      const kv = new Set(k.values.map((v) => String(v.value).toLowerCase()));
      const inter = [...av].filter((x) => kv.has(x)).length;
      return inter / Math.max(1, Math.min(av.size, kv.size)) >= 0.6;
    });
    if (!dup) kept.push(a);
  }
  return kept;
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
  // HARD axes are derived from the real catalog and, when present, are ALWAYS in the set:
  // FORMAT (strict — spray→sprays only, ADR-0034) and BUDGET (ordinal — the chosen price
  // band only, nearest tier when a form×band cell is empty, ADR-0035). Any AI axis that
  // duplicates form or price is dropped so we never ask it twice.
  const hard = [deriveFormatAxis(products), deriveBudgetAxis(products)].filter(Boolean);
  const soft = usable.filter((a) => !looksLikeFormatAxis(a) && !looksLikeBudgetAxis(a));
  const minSoft = Math.max(0, 2 - hard.length);
  if (soft.length < minSoft) return { ok: false, reason: "not-enough-axes", meta: { axes: soft.length, hard: hard.map((h) => h.id) } };

  const maxCombos = opts.maxCombos || 400; // room for the hard partition (coverage WITHIN each cell)
  const cap = opts.maxQuestions || 6;
  const maxSoft = Math.max(minSoft, Math.min(soft.length, cap - hard.length));
  const attempts = [];
  // Among trust+bland-passing sets, choose the HIGHEST-COVERAGE one (ADR-0031), largest
  // (deepest) first — but always partitioned by the hard axes (ADR-0034/0035).
  let best = null;
  for (let ssize = maxSoft; ssize >= minSoft; ssize--) {
    for (const sub of _combos(soft, ssize, 24)) {
      const set = [...hard, ...sub];
      if (set.length < 2) continue;
      const combos = set.reduce((n, a) => n * a.values.length, 1);
      if (combos > maxCombos) continue;
      const config = buildConfig(cleanCat, set, opts);
      const trust = trustValidate(config);
      const bland = antiBlandCheck(config);
      attempts.push({ axes: set.map((a) => a.id), size: set.length, trust: trust.ok, bland: bland.ok });
      if (trust.ok && bland.ok) {
        const rich = richnessCheck(config, cleanCat);
        const cand = { config, coverage: rich.metrics.coverage, richOk: rich.ok, size: set.length,
          meta: { axes: set.map((a) => a.id), questions: set.length, archetypes: config.archetypes.length, combos, coverage: rich.metrics.coverage, hard: hard.map((h) => h.id) } };
        if (!best || cand.coverage > best.coverage + 1e-9 || (Math.abs(cand.coverage - best.coverage) <= 1e-9 && cand.size > best.size)) best = cand;
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

  // GROUNDED STRICTNESS (ADR-0036): only axes whose value is confirmable from real product
  // data may be hard. Format + price qualify and are the ranked promises (rank-1 = format,
  // rank-2 = price). The mined/AI categoricals stay soft — but every soft mismatch is
  // DISCLOSED per rule (no silent override), so anti-bland's dominance cap is respected
  // while the shopper's choice is never quietly ignored.
  const axes = buildFactAxes(products);
  const hard = [deriveFormatAxis(products), deriveBudgetAxis(products)].filter(Boolean);
  const soft = axes.filter((a) => !looksLikeFormatAxis(a) && !looksLikeBudgetAxis(a));
  if (hard.length < 2 && axes.length < 2) return { ok: false, reason: "not-enough-fact-axes", meta: { factAxes: axes.length } };

  // Candidate sets: [..hard, …soft-subset], or the legacy pairs/triples when no hard axis.
  const sets = hard.length
    ? [hard.slice(), ...soft.map((s) => [...hard, s]), ..._combos(soft, 2, 24).map((sub) => [...hard, ...sub])].filter((s) => s.length >= 2)
    : _axisSets(axes);

  const attempts = [];
  for (const set of sets) {
    const combos = set.reduce((n, a) => n * a.values.length, 1);
    if (combos > 400) continue;
    const config = buildConfig(cleanCat, set, opts);
    const trust = trustValidate(config);
    const bland = antiBlandCheck(config);
    attempts.push({ set: set.map((a) => a.id), trust: trust.ok, bland: bland.ok, blandFindings: bland.findings.map((f) => f.code) });
    if (trust.ok && bland.ok) {
      return { ok: true, config, meta: { axes: set.map((a) => a.id), archetypes: config.archetypes.length, combos, hard: hard.map((h) => h.id) } };
    }
  }
  return { ok: false, reason: "no-nonbland-funnel", meta: { triedAxes: axes.map((a) => a.id), attempts } };
}
