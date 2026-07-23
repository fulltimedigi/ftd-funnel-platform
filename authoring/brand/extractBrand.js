/**
 * authoring/brand/extractBrand.js — deterministic brand auto-styling (ADR-0028, Track B).
 * ---------------------------------------------------------------------------
 * Pull the store's LOGO and COLOUR PALETTE out of the already-ingested site HTML
 * so the generated funnel visually matches the brand — like the hand-built
 * reference did — without an LLM and without a free-form theme editor
 * (opinionated defaults + a few SAFE brand overrides, per UX_INTERFACE_DECISION).
 *
 * Pure/Node-safe: HTML in, `{ logo, colors }` out; relative URLs resolved against
 * the origin. Everything is best-effort with sane fallbacks — never throws.
 */

const HEX_RE = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

function _abs(url, origin) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || /^data:/i.test(url)) return url;
  try { return new URL(url, origin).href; } catch { return url; }
}

function _meta(html, name) {
  // <meta name|property="X" content="Y"> in either attribute order
  const re = new RegExp('<meta[^>]+(?:name|property)=["\']' + name + '["\'][^>]*>', "i");
  const tag = (html.match(re) || [])[0];
  if (!tag) return "";
  const c = tag.match(/content=["']([^"']+)["']/i);
  return c ? c[1].trim() : "";
}

/** First matching logo-ish asset. */
function _logo(html, origin) {
  const og = _meta(html, "og:image");
  if (og) return _abs(og, origin);
  const apple = (html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/i) || [])[0];
  if (apple) { const h = apple.match(/href=["']([^"']+)["']/i); if (h) return _abs(h[1], origin); }
  const icon = (html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i) || [])[0];
  if (icon) { const h = icon.match(/href=["']([^"']+)["']/i); if (h) return _abs(h[1], origin); }
  // an <img> that looks like a logo
  const img = (html.match(/<img[^>]+(?:class|alt|src)=["'][^"']*logo[^"']*["'][^>]*>/i) || [])[0];
  if (img) { const s = img.match(/src=["']([^"']+)["']/i); if (s) return _abs(s[1], origin); }
  return "";
}

/** Luminance 0..1 of a #rrggbb / #rgb. */
function _lum(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
const _norm = (hex) => {
  let h = hex.replace("#", "").toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return "#" + h;
};

/**
 * @param {string} html   the ingested start-page HTML
 * @param {string} origin the site origin (for resolving relative asset URLs)
 * @returns {{ logo:string, colors:{ primary:string, accent:string, bg:string, text:string } }}
 */
export function extractBrand(html, origin = "") {
  const src = typeof html === "string" ? html : "";
  const logo = _logo(src, origin);

  // Candidate brand colours: theme-color meta first, then the most frequent
  // non-neutral hex in the markup (brands repeat their accent everywhere).
  const themeColor = _meta(src, "theme-color");
  const counts = new Map();
  let m;
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(src)) !== null) {
    const hex = _norm(m[0]);
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  // vivid = not near-white and not near-black (skip layout greys)
  const vivid = ranked.filter((h) => { const l = _lum(h); return l > 0.08 && l < 0.92; });

  const primary = _norm(themeColor && /^#/.test(themeColor.trim()) ? themeColor.trim() : (vivid[0] || "#0f766e"));
  const accent = vivid.find((h) => h !== primary) || primary;
  // background: prefer a very light hex present in the page, else warm off-white.
  const light = ranked.find((h) => _lum(h) >= 0.92) || "#faf8f4";
  const text = "#1f2430";

  return { logo, colors: { primary, accent, bg: light, text } };
}

/** Map a brand profile to engine `themeVars` (:root CSS custom properties). */
export function brandToThemeVars(brand) {
  const c = (brand && brand.colors) || {};
  const vars = {};
  if (c.primary) { vars["--brand"] = c.primary; vars["--accent"] = c.primary; vars["--cta-bg"] = c.primary; }
  if (c.accent) vars["--brand-accent"] = c.accent;
  if (c.bg) vars["--bg"] = c.bg;
  if (c.text) vars["--ink"] = c.text;
  return vars;
}
