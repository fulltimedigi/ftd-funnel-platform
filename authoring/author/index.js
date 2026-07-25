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
import { select as kernelSelect, EXACT, NO_MATCH } from "../../engine/kernel/constraintKernel.js";
import { compileConstraints, compileUnits, comboAnswers, excludedSkuReport } from "../../engine/kernel/compile.js";
import { meaningfulOptions } from "../../engine/kernel/labelQuality.js";
import { catalogVersion, policyVersion, answerContractVersion, localeBundleVersion, configHash } from "../../engine/kernel/version.js";
import { verifyFunnel } from "../../engine/kernel/verifyFunnel.js";
import { isSafetyAxis } from "../../engine/kernel/safety.js";
import { pickCalibrated, exactPathStats, surfacedCoverage, differentiatingDensity, EXACT_PATH_TARGET } from "../quality/depthCalibration.js";
import { RICHNESS_DEFAULTS } from "../quality/richnessCheck.js";

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
/**
 * Covering assignment, DELEGATED TO THE CONSTRAINT KERNEL (ADR-0037, Promise Principle v3).
 * ---------------------------------------------------------------------------------------------
 * The kernel (engine/kernel/constraintKernel.js) is now the SINGLE source of truth for what
 * "matches" means (Guardrail G1): for every answer-combo we call `kernel.select`, which runs the
 * lexicographic partial-CSP (exclude never-relax violations/unknowns → smallest loss vector →
 * exact dominance → relaxation bounds). This function keeps only the COVERAGE policy, expressed
 * as the kernel's allowed *tie-break* between equal-quality matches: prefer a product not yet
 * used as a #1, then the higher-quality shell. It carries NO independent matching logic.
 *
 * Returns per-combo the winning product AND the kernel's proof-carrying SelectionResult, plus
 * the compiled constraints and the catalog/policy versions (Guardrail G2). Twins that tie the
 * winner EXACTLY are recorded as ranked alternates.
 */
function _assignCovering(products, axisSet, combos, overall) {
  const key = (c) => c.join("¦");
  const constraints = compileConstraints(axisSet);
  const units = compileUnits(products, axisSet);
  const unitByUrl = new Map(units.map((u) => [u.id, u]));
  const catalogUrls = new Set(units.map((u) => u.id));
  const catVer = catalogVersion(products);
  const polVer = policyVersion(constraints);

  // Quality rank (lower = better shell): reproduces _bestProduct's ordering as a scalar for the
  // fine tie-break, so equal-loss ties resolve to the premium product — deterministically.
  const ranked = [...products].sort((a, b) => (_bestProduct([a, b]) === a ? -1 : 1));
  const qualityRank = new Map(ranked.map((p, i) => [p.url, i]));
  const used = new Set(); // #1 products so far — coverage tie-break prefers a FRESH one
  const tieBreak = (u) => (used.has(u.id) ? 1e7 : 0) + (qualityRank.get(u.id) ?? 1e6);
  // NO loosened budget bound is passed: the kernel reads the relaxation DISTANCE (=1 tier) from the
  // numbered policy registry itself (audit #6). A cell with no product within 1 tier is an honest
  // NO_MATCH — NEVER a global-best fallback (the forbidden path of audit #3 is deleted here).
  const opts = { catalogVersion: catVer, policyVersion: polVer, catalogUrls, tieBreak };

  const winnerByCombo = new Map(), altByUrl = new Map(), proofByCombo = new Map(), terminalByCombo = new Map();
  // Two passes so the FRESH tie-break maximises distinct #1 coverage: pass 1 lets every product
  // claim a home cell it wins outright; pass 2 fills the rest, still kernel-decided.
  const order = [...combos];
  for (const pass of [0, 1]) {
    for (const combo of order) {
      const k = key(combo);
      if (winnerByCombo.has(k) || terminalByCombo.has(k)) continue;
      const answers = comboAnswers(axisSet, combo);
      const res = kernelSelect(units, constraints, answers, opts);
      const winner = res.product_id ? (unitByUrl.get(res.product_id) || {}).product : null;
      if (!winner) { // honest NO_MATCH: no product within budget on this path — a first-class TERMINAL cell.
        if (pass === 0) continue; // defer to pass 1 (a fresher home might still claim a neighbour)
        terminalByCombo.set(k, res); // NO_MATCH — no product routed, ever (kernel-proven no candidate)
        continue;
      }
      // In pass 0, only lock a cell whose winner is EXACT and still fresh (its true home); defer
      // compromises to pass 1 so fresh products aren't consumed by a neighbour's relaxed cell.
      if (pass === 0 && (res.match_state !== EXACT || used.has(winner.url))) continue;
      winnerByCombo.set(k, winner); proofByCombo.set(k, res); used.add(winner.url);
    }
  }
  // Ranked-alternate twins: any product whose OWN full profile equals a combo whose winner is a
  // different product is that winner's nearest alternate (kernel-EXACT on the same cell).
  const val = (p, a) => a.profile.get(p.url);
  const isFull = (p) => axisSet.every((a) => val(p, a) != null);
  for (const p of products) {
    if (!isFull(p)) continue;
    const homeKey = key(axisSet.map((a) => val(p, a)));
    const w = winnerByCombo.get(homeKey);
    if (w && w.url !== p.url) { const list = altByUrl.get(w.url) || []; list.push(p); altByUrl.set(w.url, list); }
  }
  return { winnerByCombo, altByUrl, proofByCombo, terminalByCombo, constraints, catalogVersion: catVer, policyVersion: polVer };
}

/* ---- fact axes (categorical, fact-framed, ≤4 values each) ------------------ */

function _priceLabel(v) {
  const m = { budget: "اقتصادي", mid: "متوسط", premium: "مميّز" };
  return m[v.value] || v.value;
}

const _FACET_Q = ["أي طابع تفضّل؟", "ما التفضيل الأقرب لك؟", "أي فئة تناسبك أكثر؟"];

export function buildFactAxes(products) {
  const d = deriveAxes({ products });
  const axes = [];

  const price = d.axes.find((a) => a.id === "price");
  if (price && price.values.length >= 2) {
    const profile = new Map();
    price.values.forEach((v) => v.productUrls.forEach((u) => profile.set(u, v.value)));
    axes.push({ id: "budget", label: "الميزانية", question: "ما ميزانيتك التقريبية؟", values: price.values.map((v) => ({ value: v.value, label: _priceLabel(v) })), profile });
  }

  // name-mined mutually-exclusive facet axes (form / origin / size), clustered by
  // co-occurrence in axes.js — each carries a url→value profile.
  // P0 (FUNNEL-QUALITY-FIX-PLAN): the mined token is used as the RAW label here, so obvious
  // non-attributes must never reach a shopper — junk/function words ("de"/"based"/"packages")
  // and UNITS ("tola"/"3ml"). Drop those options; a taste axis with <2 meaningful options is
  // dropped entirely (honesty > depth). The axis STRUCTURE is real (origin/form) and kept when
  // it survives — P1 replaces these raw labels with LLM-designed, translated names
  // (e.g. المصدر: هندي/كمبودي) behind an evidence + validity gate.
  for (const fa of d.axes.filter((a) => String(a.id).startsWith("facet"))) {
    const values = meaningfulOptions(fa.values.map((v) => ({ value: v.value, label: v.value })));
    if (values.length < 2) continue;
    axes.push({ id: fa.id, label: "الطابع", question: _FACET_Q[axes.length % _FACET_Q.length], values, profile: fa.profile });
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

  // PROMISE BINDING (ADR-0037 closing): never OFFER an answer no product carries. Prune option
  // values with zero SKUs in the profile (a dead option) — honesty > depth: the funnel gets
  // shorter, it never asks a question that leads nowhere. Axes left with <2 live values are dropped.
  axisSet = axisSet
    .map((a) => { const present = new Set([...a.profile.values()].filter((v) => v != null).map(String)); const values = a.values.filter((v) => present.has(String(v.value))); return values.length === a.values.length ? a : { ...a, values }; })
    .filter((a) => a.values.length >= 2);

  // 1. COVERING assignment (ADR-0031): every product owns the combo matching its own
  //    profile → no product is orphaned. "Results First, Questions Last."
  const combos = cartesian(axisSet.map((a) => a.values.map((v) => v.value)));
  const overall = _bestProduct(products);
  const { winnerByCombo, altByUrl, proofByCombo, terminalByCombo, constraints: kConstraints, catalogVersion: catVer, policyVersion: polVer } = _assignCovering(products, axisSet, combos, overall);
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

  // 2c. ALTERNATE PROOFS (ADR-0037 BLOCKER-3): every surfaced alternate is ALSO a kernel decision.
  //     Each alternate is proven a valid recommendation for its archetype's own answer-path (the
  //     primary's home combo): it must pass NEVER_RELAX. An alternate we cannot prove is DROPPED —
  //     no renderable result, primary OR alternate, ever ships without a certificate.
  const kUnits = compileUnits(products, axisSet);
  const kUnitByUrl = new Map(kUnits.map((u) => [u.id, u]));
  const homeAnswersOf = (url) => { const u = kUnitByUrl.get(url); const ans = {}; if (u) for (const a of axisSet) { const g = u.values.get(a.id); if (g) ans[a.id] = g.value; } return ans; };
  for (const a of archetypes) {
    const ans = homeAnswersOf(a.recommendations.primary.url);
    const kept = [];
    for (const c of a.recommendations.contextual || []) {
      const u = kUnitByUrl.get(c.url);
      if (!u) continue;
      // No budget bound is handed to the matcher — the kernel reads maxBudgetTierDistance from the
      // numbered policy registry itself (ADR-0039 / audit #6). An alternate proven against its OWN
      // home answers is EXACT by construction; the cap only matters if the home answers ever relax.
      const res = kernelSelect([u], kConstraints, ans, { catalogUrls: new Set([c.url]) });
      if (!res.product_id) continue; // fails NEVER_RELAX for this path → not renderable → drop
      c.proof = { match_state: res.match_state, conflicts: res.conflicts, unknowns: res.unknowns, variant_id: res.variant_id };
      kept.push(c);
    }
    if (a.recommendations.contextual) a.recommendations.contextual = kept;
  }

  // 3. signals + derived signals + questions
  const signals = [], derivedSignals = [], questions = [];
  axisSet.forEach((a, ai) => {
    const sid = `s_${a.id}`, qid = `q_${a.id}`;
    const sig = { id: sid, role: "decision", required: true, source: qid, domain: a.values.map((v) => v.value), map: {}, advisory: !!a.advisory };
    // ADVISORY axes are asked as an explicit PREFERENCE, never phrased as a firm requirement
    // (depth calibration, move d) — so the shopper is never promised something we won't hard-match.
    const text = a.advisory ? `${a.question} (تفضيل اختياري — نراعيه إن أمكن)` : a.question;
    const q = { id: qid, label: `السؤال ${ai + 1}`, text, advisory: !!a.advisory, options: a.values.map((v, i) => { const oid = `opt_${a.id}_${i}`; sig.map[oid] = v.value; return { id: oid, label: clamp(v.label, 60) }; }) };
    signals.push(sig); questions.push(q);
    derivedSignals.push({ id: `D_${a.id}`, from: [sid], rule: "identity", domain: a.values.map((v) => v.value) });
  });

  // 4. decision table: one rule per combo → winner archetype. The rule is a MATERIALIZED CACHE
  //    of the kernel's SelectionResult for that answer-path (Guardrail G1): no matching logic
  //    lives here. Each rule carries the kernel PROOF (match_state, matches, conflicts, unknowns,
  //    variant_id) so the renderer and the runtime verifier read structured fields, never prose.
  //    RULE-LEVEL HONESTY: `relaxed` (legacy shape) = the kernel's conflicts (VIOLATED answers),
  //    with never-relax rank-1 guaranteed absent (the kernel excluded any unit that violates it).
  //    DISCRIMINATED UNION (ADR-0039 / audit #3): a rule is COMMERCE (ProvenSelection) or TERMINAL
  //    (an actionable NO_MATCH — reason + next_action + a terminal_proof that no candidate exists
  //    within the constraints & the 1-tier budget bound). A cell with no product is NEVER routed to
  //    a global best; it is an honest, actionable dead-end the shopper can act on.
  const decisionTable = combos.map((combo, ci) => {
    const k = combo.join("¦");
    const when = Object.fromEntries(axisSet.map((a, i) => [`D_${a.id}`, combo[i]]));
    const winner = winnerByCombo.get(k);
    if (!winner) {
      const tres = terminalByCombo.get(k);
      return {
        id: `r_${ci}`, kind: "TERMINAL", when,
        terminal_state: "NO_MATCH", reason_code: "NO_PRODUCT_WITHIN_CONSTRAINTS",
        message_key: "terminal.no_match", next_action: "EDIT_ANSWERS",
        // terminal_proof: the kernel returned NO product for this path — records why (bounds).
        terminal_proof: { product_id: null, policy_hash: tres && tres.policy_hash, tie_break_reason: (tres && tres.tie_break_reason) || "no eligible unit within the 1-tier budget bound" },
      };
    }
    const proof = proofByCombo.get(k);
    const rule = { id: `r_${ci}`, kind: "COMMERCE", when, result: archId.get(winner.url) };
    rule.proof = {
      product_id: proof.product_id, match_state: proof.match_state, variant_id: proof.variant_id,
      matches: proof.matches, conflicts: proof.conflicts, unknowns: proof.unknowns,
      tie_break_reason: proof.tie_break_reason, policy_hash: proof.policy_hash,
    };
    const relaxed = (proof.conflicts || []).map((c) => { const o = { axis: c.axis, label: c.label }; if (c.dir) o.dir = c.dir; if (c.soft) o.soft = true; if (c.advisory) o.advisory = true; return o; });
    if (relaxed.length) rule.relaxed = relaxed;
    return rule;
  });
  // The default rule (when:{}) is TERMINAL only (audit #3): it can NEVER route a product. It fires
  // only when NO combo rule matched — a missing / edited / stale answer left a signal undefined — so
  // the honest, actionable outcome is RESTART_REQUIRED (never NO_MATCH, never a product).
  decisionTable.push({
    id: "r_default", kind: "TERMINAL", when: {},
    terminal_state: "RESTART_REQUIRED", reason_code: "INCOMPLETE_ANSWERS",
    message_key: "terminal.restart", next_action: "START_OVER",
  });

  const config = {
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
    // Guardrail G2 (ADR-0037): content-hash versions let the runtime verifier tell whether the
    // served SKU still belongs to the catalog + policy this table was compiled against (staleness).
    catalog_version: catVer,
    policy_version: polVer,
    // The typed constraint policy the kernel compiled — the runtime re-verifier re-derives status
    // from this, so "matches" means the SAME thing at author time and at render time (G1).
    constraintPolicy: (kConstraints || []).map((c) => ({ id: c.id, type: c.type, mode: c.mode, priority: c.priority, order: c.order })),
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
  // VERSION COHERENCE stamps (ADR-0037 closing): the NAMED answer contract, the locale bundle, and
  // one config hash covering the decision-relevant shape. The runtime verifier compares these with
  // what the client actually saw — any drift is STALE, never a silent mix of two versions.
  config.answer_contract_version = answerContractVersion(signals, questions);
  config.locale_bundle_version = localeBundleVersion(config);
  config.config_hash = configHash(config);
  return config;
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

/**
 * ADVISORY variants of a taste subset (depth calibration, move d). Returns the original set plus,
 * for each taste axis, a variant that keeps THAT axis a promise and demotes the rest to ADVISORY
 * (a preference — asked, disclosed on difference, but never a broken promise). The meaning guard
 * always keeps ≥1 promised taste axis. A ≤1-axis subset has no advisory variant (nothing to demote).
 */
function _advisoryVariants(tasteSub) {
  if (!tasteSub || tasteSub.length < 2) return [tasteSub || []];
  const out = [tasteSub];
  for (let j = 0; j < tasteSub.length; j++) out.push(tasteSub.map((a, i) => (i === j ? a : { ...a, advisory: true })));
  return out;
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

  // SAFETY BLOCK (ADR-0039, explicit honesty item): safety.js's fail-closed enforcement needs an
  // official-evidence pipeline (resolveSafetyEvidence) that the ingestion path does NOT yet supply.
  // Until it does, publishing a safety/allergen/compatibility/legal axis is REFUSED — we never ship a
  // safety promise we can't ground from an official source. safety.js is the single detector (wired).
  const safetyAxes = (axes || []).filter((a) => isSafetyAxis(a));
  if (safetyAxes.length) return { ok: false, reason: "safety-axis-unsupported", meta: { axes: safetyAxes.map((a) => a.id), categories: safetyAxes.map((a) => a.category), note: "safety/allergen/compatibility/legal axes are blocked until official-evidence grounding is wired (engine/kernel/safety.js resolveSafetyEvidence)" } };

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
  // DEPTH CALIBRATION (ADR-0037 depth phase): collect EVERY gate+verify-passing candidate, then
  // pick the deepest MEANINGFUL funnel whose exact-path-rate ≥ target — else the best HONEST one.
  // We no longer just maximise depth/coverage (that over-asked taste axes the catalog can't match).
  const candidates = [];
  const variantsOf = (sub) => (opts.legacyDepth ? [sub] : _advisoryVariants(sub)); // legacyDepth = pre-calibration behaviour (report/regression baseline)
  for (let ssize = maxSoft; ssize >= minSoft; ssize--) {
    for (const sub of _combos(soft, ssize, 24)) {
      for (const vsub of variantsOf(sub)) {
        const set = [...hard, ...vsub];
        if (set.length < 2) continue;
        const combos = set.reduce((n, a) => n * a.values.length, 1);
        if (combos > maxCombos) continue;
        const config = buildConfig(cleanCat, set, opts);
        const trust = trustValidate(config);
        const bland = antiBlandCheck(config);
        attempts.push({ axes: set.map((a) => (a.advisory ? a.id + "*" : a.id)), size: set.length, trust: trust.ok, bland: bland.ok });
        if (!(trust.ok && bland.ok)) continue;
        const verify = verifyFunnel(config, cleanCat, set); // publish-time proof (ADR-0037)
        if (!verify.ok) { attempts.push({ axes: set.map((a) => a.id), verifyFindings: verify.findings.slice(0, 6) }); continue; }
        // NO richness pre-filter (ADR-0037): richness must not reject candidates by product count
        // before calibration. Coverage floor is a hard gate; richness verifies the pick afterwards.
        candidates.push({ config, set, verify, coverage: surfacedCoverage(config) / products.length, combos });
      }
    }
  }
  const minCov = RICHNESS_DEFAULTS.minCoverage;
  const covPass = candidates.filter((c) => c.coverage >= minCov - 1e-9); // hard surfaced-coverage floor
  const pool = covPass.length ? covPass : candidates;
  if (pool.length) {
    const T = opts.exactPathTarget != null ? opts.exactPathTarget : EXACT_PATH_TARGET;
    const density = differentiatingDensity(cleanCat);
    let chosen, targetMet = null, limiting = null, scored = pool, deeperFeasibleExists = false;
    if (opts.legacyDepth) { // baseline: old max-coverage-then-deepest pick (with the old count-richness prefilter)
      const withRich = pool.filter((c) => richnessCheck(c.config, cleanCat, { deeperFeasibleExists: differentiatingDensity(cleanCat) >= RICHNESS_DEFAULTS.richDensityMin }).ok);
      const s = (withRich.length ? withRich : pool).slice().sort((a, b) => b.coverage - a.coverage || b.set.length - a.set.length);
      chosen = { config: s[0].config };
    } else ({ chosen, targetMet, limiting, scored, deeperFeasibleExists } = pickCalibrated(pool, cleanCat, T, minCov));
    const cand = pool.find((c) => c.config === chosen.config);
    // richness now VERIFIES the calibrated pick (never re-selects): thin only if a deeper FEASIBLE
    // funnel exists (it doesn't — pickCalibrated took the deepest feasible), coverage floor enforced.
    const rich = richnessCheck(chosen.config, cleanCat, { deeperFeasibleExists, density, minCoverage: minCov });
    if (!rich.ok) return { ok: false, reason: "richness", meta: { findings: rich.findings, density } };
    const st = exactPathStats(chosen.config);
    // Excluded-SKU report (ADR-0039): SKUs UNKNOWN on a NEVER_RELAX axis (e.g. ambiguous format) are
    // excluded from the eligible pool with a reason — never auto-mapped to an "OTHER" bucket. Coverage
    // is reported against the ELIGIBLE denominator so the exclusion is honest, not silent.
    const excl = excludedSkuReport(products, chosen.set);
    return { ok: true, config: chosen.config, meta: {
      axes: cand.set.map((a) => a.id), questions: cand.set.length, archetypes: chosen.config.archetypes.length, combos: cand.combos,
      coverage: cand.coverage, hard: hard.map((h) => h.id), verify: cand.verify,
      excludedSkus: { count: excl.excluded.length, eligible: excl.eligibleCount, total: excl.totalCount, items: excl.excluded },
      depthCalibration: { targetMet, target: T, exactPaths: st.exactPaths, reachablePaths: st.reachablePaths, rate: st.rate, surfaced: surfacedCoverage(chosen.config), density, deeperFeasibleExists, candidatesEvaluated: scored.length, limiting },
    } };
  }
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
  // DEPTH CALIBRATION (ADR-0037 depth phase): gather every gate+verify-passing candidate, then pick
  // the deepest MEANINGFUL funnel whose exact-path-rate ≥ target — else the best HONEST one. This
  // stops the layer from over-asking taste axes the catalog can't match exactly.
  const hardIds = new Set(hard.map((h) => h.id));
  const candidates = [];
  const variantsOf = (sub) => (opts.legacyDepth ? [sub] : _advisoryVariants(sub));
  for (const baseSet of sets) {
    const tasteSub = baseSet.filter((a) => !hardIds.has(a.id));
    const hardPart = baseSet.filter((a) => hardIds.has(a.id));
    for (const vsub of variantsOf(tasteSub)) {
      const set = [...hardPart, ...vsub];
      const combos = set.reduce((n, a) => n * a.values.length, 1);
      if (combos > 400) continue;
      const config = buildConfig(cleanCat, set, opts);
      const trust = trustValidate(config);
      const bland = antiBlandCheck(config);
      attempts.push({ set: set.map((a) => (a.advisory ? a.id + "*" : a.id)), trust: trust.ok, bland: bland.ok, blandFindings: bland.findings.map((f) => f.code) });
      if (!(trust.ok && bland.ok)) continue;
      // PUBLISH-TIME exhaustive verification (ADR-0037): prove the v3 exit criteria before shipping.
      const verify = verifyFunnel(config, cleanCat, set);
      if (!verify.ok) { attempts.push({ set: set.map((a) => a.id), verifyFindings: verify.findings.slice(0, 6) }); continue; }
      candidates.push({ config, set, verify, combos });
    }
  }
  const minCov = RICHNESS_DEFAULTS.minCoverage;
  const covPass = candidates.filter((c) => surfacedCoverage(c.config) / products.length >= minCov - 1e-9);
  const pool = covPass.length ? covPass : candidates;
  if (pool.length) {
    const T = opts.exactPathTarget != null ? opts.exactPathTarget : EXACT_PATH_TARGET;
    const density = differentiatingDensity(cleanCat);
    let chosen, targetMet = null, limiting = null, scored = pool, deeperFeasibleExists = false;
    if (opts.legacyDepth) { // baseline: old first-passing (order already deepest-hard-first) → first
      chosen = { config: pool[0].config };
    } else ({ chosen, targetMet, limiting, scored, deeperFeasibleExists } = pickCalibrated(pool, cleanCat, T, minCov));
    const cand = pool.find((c) => c.config === chosen.config);
    const rich = richnessCheck(chosen.config, cleanCat, { deeperFeasibleExists, density, minCoverage: minCov });
    if (!rich.ok) return { ok: false, reason: "richness", meta: { findings: rich.findings, density } };
    const st = exactPathStats(chosen.config);
    return { ok: true, config: chosen.config, meta: {
      axes: cand.set.map((a) => a.id), archetypes: chosen.config.archetypes.length, combos: cand.combos, hard: hard.map((h) => h.id), verify: cand.verify,
      depthCalibration: { targetMet, target: T, exactPaths: st.exactPaths, reachablePaths: st.reachablePaths, rate: st.rate, surfaced: surfacedCoverage(chosen.config), density, deeperFeasibleExists, candidatesEvaluated: scored.length, limiting },
    } };
  }
  return { ok: false, reason: "no-nonbland-funnel", meta: { triedAxes: axes.map((a) => a.id), attempts } };
}
