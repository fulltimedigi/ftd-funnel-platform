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

/** Tertile cutpoints from the real prices — [c1, c2] (3 tiers), [c1] (2), or null. */
export function priceCutpoints(products) {
  const prices = (products || []).map(cleanPrice).filter((x) => x != null).sort((a, b) => a - b);
  if (prices.length < 6) return null;
  const at = (f) => prices[Math.min(prices.length - 1, Math.floor(f * prices.length))];
  const c1 = at(1 / 3), c2 = at(2 / 3);
  if (c1 < c2) return [c1, c2];
  const med = at(1 / 2);
  return med > prices[0] ? [med] : null;
}

/** Tier index of a price given cutpoints: 0..cuts.length. */
export function tierOf(price, cuts) {
  if (price == null || !cuts) return null;
  let t = 0;
  for (const c of cuts) if (price >= c) t++;
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
  const labelFor = (t) => {
    if (t === 0) return `أقل من ${_fmt(cuts[0])}${suffix}`;
    if (t === nT - 1) return `أكثر من ${_fmt(cuts[t - 1])}${suffix}`;
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
