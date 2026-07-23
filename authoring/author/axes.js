/**
 * authoring/author/axes.js — Derive DECISION AXES from a catalog (ADR-0014).
 * ---------------------------------------------------------------------------
 * Stage 2 step 1. Finds the attributes that actually DIFFERENTIATE the real
 * products — the axes a funnel question can be built on. A question is only worth
 * asking if it maps to an axis that splits the catalog (design RULE 4/7).
 *
 * Deterministic + dependency-free: analyses real fields (price, type, tags,
 * title keywords), scores each candidate by how evenly it splits the catalog
 * (normalized entropy) and how much it covers, and ranks. Every axis value
 * carries the real product URLs under it — nothing is invented. Pure, Node-safe.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "with", "and", "or", "in", "on", "to", "by", "from",
  "new", "sale", "set", "pack", "box", "piece", "pieces", "size", "ml", "gm", "g",
]);

/** Tokenize text → normalized terms with a letter (Latin or Arabic); drop noise. */
export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && /[a-z؀-ۿ]/u.test(t) && !STOPWORDS.has(t));
}

/** Normalized Shannon entropy (0..1) over value counts; 1 = perfectly even split. */
export function entropy(counts) {
  const total = counts.reduce((s, n) => s + n, 0);
  const k = counts.filter((n) => n > 0).length;
  if (total === 0 || k <= 1) return 0;
  let h = 0;
  for (const n of counts) { if (n > 0) { const p = n / total; h -= p * Math.log(p); } }
  return h / Math.log(k);
}

function _round(n) { return Math.round(n * 100) / 100; }

/** Price tertile-band axis, or null when too few/undispersed prices. */
function _priceAxis(products) {
  const priced = products.filter((p) => typeof p.price === "number");
  const prices = priced.map((p) => p.price).sort((a, b) => a - b);
  const distinct = new Set(prices).size;
  if (priced.length < Math.max(4, products.length * 0.4) || distinct < 3) return null;

  const t1 = prices[Math.floor(prices.length / 3)];
  const t2 = prices[Math.floor((2 * prices.length) / 3)];
  if (!(t1 < t2)) return null; // no real spread

  const band = (p) => (p <= t1 ? "budget" : p >= t2 ? "premium" : "mid");
  const labels = {
    budget: `budget (≤ ${_round(t1)})`,
    mid: `mid (${_round(t1)}–${_round(t2)})`,
    premium: `premium (≥ ${_round(t2)})`,
  };
  const buckets = { budget: [], mid: [], premium: [] };
  for (const p of priced) buckets[band(p.price)].push(p.url);

  const values = Object.keys(buckets)
    .filter((v) => buckets[v].length > 0)
    .map((v) => ({ value: v, label: labels[v], count: buckets[v].length, productUrls: buckets[v] }));
  if (values.length < 2) return null;
  return _scoreAxis({ id: "price", label: "Price band", source: "price", values }, products.length);
}

/** Categorical axis from a per-product string getter (type, brand, …). */
function _categoricalAxis(products, get, meta, minCoverage) {
  const map = new Map();
  for (const p of products) {
    const raw = (get(p) || "").toString().trim();
    if (!raw) continue;
    if (!map.has(raw)) map.set(raw, []);
    map.get(raw).push(p.url);
  }
  const values = [...map.entries()]
    .map(([value, urls]) => ({ value, label: value, count: urls.length, productUrls: urls }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const classified = values.reduce((s, v) => s + v.count, 0);
  if (values.length < 2 || values.length > 15) return null;
  if (classified / products.length < minCoverage) return null;
  return _scoreAxis({ ...meta, values }, products.length);
}

/** Attach coverage + discrimination scores to an axis. */
function _scoreAxis(axis, total) {
  const classified = axis.values.reduce((s, v) => s + v.count, 0);
  axis.coverage = _round(classified / total);
  axis.discrimination = _round(entropy(axis.values.map((v) => v.count)));
  axis.score = _round(axis.coverage * axis.discrimination);
  return axis;
}

/**
 * Discriminating keyword facets from titles + tags: terms that appear in SOME
 * products (not one, not ~all). Ranked by balance (closest to a 50/50 split).
 */
export function keywordFacets(products, opts = {}) {
  const total = products.length;
  const minDf = opts.minDf ?? 2;
  const maxFrac = opts.maxFrac ?? 0.7;
  const topN = opts.topN ?? 15;

  const df = new Map(); // term -> [urls]
  for (const p of products) {
    const terms = new Set(tokenize(`${p.name} ${(p.differentiators || []).join(" ")} ${p.attributes?.type || ""}`));
    for (const t of terms) { if (!df.has(t)) df.set(t, []); df.get(t).push(p.url); }
  }
  const facets = [...df.entries()]
    .filter(([, urls]) => urls.length >= minDf && urls.length <= total * maxFrac)
    .map(([term, urls]) => ({ term, count: urls.length, balance: _round(Math.min(urls.length, total - urls.length) / (total / 2)), productUrls: urls }))
    .sort((a, b) => b.balance - a.balance || b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, topN);
  return facets;
}

/**
 * Derive ranked decision axes from a catalog.
 * @param {{products:Array}} catalog
 * @param {Object} [opts] - { minCoverage=0.2, topFacets=15 }
 * @returns {{ productCount:number, axes:Array, facets:Array }}
 */
export function deriveAxes(catalog, opts = {}) {
  const products = (catalog && catalog.products) || [];
  const minCoverage = opts.minCoverage ?? 0.2;

  const candidates = [
    _priceAxis(products),
    _categoricalAxis(products, (p) => p.attributes?.type, { id: "type", label: "Product type", source: "attributes.type" }, minCoverage),
    _categoricalAxis(products, (p) => p.brand, { id: "brand", label: "Brand", source: "brand" }, minCoverage),
  ].filter(Boolean).filter((a) => a.discrimination > 0);

  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return {
    productCount: products.length,
    axes: candidates,
    facets: keywordFacets(products, { topN: opts.topFacets ?? 15 }),
  };
}
