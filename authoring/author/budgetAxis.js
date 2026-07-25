/**
 * authoring/author/budgetAxis.js — the HARD (ordinal) "budget" axis (ADR-0035).
 * ---------------------------------------------------------------------------
 * Price tier is a FACT of the catalog, not a soft preference. If a shopper picks a
 * price band they must see products IN that band — a "< 500" buyer never gets a 4000
 * piece. Tiers are derived deterministically from the real cleaned prices (tertiles),
 * and each tier is LABELLED with its real range so the text the shopper reads == the
 * filter. The axis is `hard` + `ordinal`: an exact-tier product always wins; only when
 * a (form × tier) cell is genuinely EMPTY (e.g. this store has no cheap perfume) does
 * selection fall to the NEAREST tier — of the same form, never across it, never wildly
 * off. The AI may not touch it — price is a fact.
 *
 * Pure/Node-safe.
 */

/** Numeric price of a product (strip currency text); null if unusable. */
export function cleanPrice(p) {
  if (!p) return null;
  const n = Number(String(p.price != null ? p.price : "").replace(/[^0-9.]/g, ""));
  return isFinite(n) && n > 0 ? n : null;
}

/** Round a cutpoint to a human-friendly step so a shopper reads "450" not "459".
 *  The SAME rounded value drives both the label and tierOf, so text == filter (FIX-4).
 *  Below 100 we keep the exact value: there a unit or two is meaningful (a 48 vs 50 coffee)
 *  and coarse rounding could shift which products fall in a tier — cosmetic only where it's safe. */
export function niceRound(n) {
  if (!(n >= 100)) return n;
  const step = n < 1000 ? 50 : n < 10000 ? 100 : 500;
  return Math.round(n / step) * step;
}

/** Tertile cutpoints from the real prices, rounded to human steps — [c1, c2] (3 tiers),
 *  [c1] (2), or null. Rounding is applied to the canonical cuts so labels + predicates match. */
export function priceCutpoints(products) {
  const prices = (products || []).map(cleanPrice).filter((x) => x != null).sort((a, b) => a - b);
  if (prices.length < 6) return null;
  const at = (f) => prices[Math.min(prices.length - 1, Math.floor(f * prices.length))];
  const c1 = at(1 / 3), c2 = at(2 / 3);
  if (c1 < c2) {
    const r1 = niceRound(c1), r2 = niceRound(c2);
    return (r1 > 0 && r1 < r2) ? [r1, r2] : [c1, c2]; // fall back if rounding collapses the order
  }
  const med = at(1 / 2);
  if (med > prices[0]) { const r = niceRound(med); return [r > 0 ? r : med]; }
  return null;
}

/**
 * Tier index of a price given cutpoints: 0..cuts.length. CANONICAL boundary rule (FIX-4): each
 * cut is the INCLUSIVE LOWER bound of its tier — `price >= c` moves up a tier. The labels
 * (`labelFor`) are derived from the SAME cuts with the SAME inclusivity, so the number a shopper
 * reads is exactly the number the predicate applies: a product priced at a boundary sits in the
 * tier whose label includes that boundary, never one that excludes it.
 */
export function tierOf(price, cuts) {
  if (price == null || !cuts) return null;
  let t = 0;
  for (const c of cuts) if (price >= c) t++; // boundary belongs to the UPPER tier (inclusive-low)
  return t;
}

/** Deterministic budget tier of a product ("0"|"1"|…) or null (no price → wildcard). */
export function productBudget(p, cuts) {
  const t = tierOf(cleanPrice(p), cuts);
  return t == null ? null : String(t);
}

const _fmt = (n) => Math.round(n).toLocaleString("en-US");

/** Build the HARD ordinal budget axis (real range labels). Null if <2 populated tiers. */
export function deriveBudgetAxis(products) {
  const cuts = priceCutpoints(products);
  if (!cuts) return null;
  const cur = ((products || []).find((p) => cleanPrice(p) != null) || {}).currency || "";
  const suffix = cur ? " " + cur : "";
  const profile = new Map();
  const present = new Set();
  for (const p of products || []) {
    const b = productBudget(p, cuts);
    if (b != null) { profile.set(p.url, b); present.add(b); }
  }
  const nT = cuts.length + 1;
  // Labels derive from the SAME canonical cuts as tierOf, with matching inclusivity (FIX-4):
  //   tier 0    → "أقل من c1"        (price < c1)
  //   tier mid  → "c(t-1) – c(t)"    ([c(t-1), c(t)) — lower inclusive, upper exclusive)
  //   tier top  → "c(last) فأكثر"    ([c(last), ∞) — inclusive, so a price AT the cut reads truthfully)
  const labelFor = (t) => {
    if (t === 0) return `أقل من ${_fmt(cuts[0])}${suffix}`;
    if (t === nT - 1) return `${_fmt(cuts[t - 1])}${suffix} فأكثر`;
    return `${_fmt(cuts[t - 1])} – ${_fmt(cuts[t])}${suffix}`;
  };
  const values = [];
  for (let t = 0; t < nT; t++) if (present.has(String(t))) values.push({ value: String(t), label: labelFor(t) });
  if (values.length < 2) return null;
  return { id: "budget", label: "الميزانية", question: "ما ميزانيتك التقريبية؟", values, profile, hard: true, ordinal: true, cuts };
}

const BUDGET_WORDS = /ميزانية|سعر|رخيص|غالي|اقتصادي|متوسّ?ط|مميّ?ز|فاخر|budget|price|premium|luxury|cheap|affordable|أقل\s*من|أكثر\s*من|\bريال\b|\bsar\b|\busd\b/i;

/** Does an AI/mined axis duplicate the budget axis (so we drop it)? */
export function looksLikeBudgetAxis(axis) {
  if (!axis || !Array.isArray(axis.values)) return false;
  if (/ميزانية|سعر|\bbudget\b|\bprice\b/i.test(String(axis.label || axis.id || ""))) return true;
  const hits = axis.values.filter((v) => {
    const t = String((v && (v.label || v.value)) || "");
    return BUDGET_WORDS.test(t) || /\d{3,}/.test(t); // budget words or a price-sized number
  }).length;
  return hits >= Math.ceil(axis.values.length / 2);
}
