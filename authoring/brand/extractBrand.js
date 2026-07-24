/**
 * authoring/brand/extractBrand.js — deterministic brand auto-styling (ADR-0028/0033).
 * ---------------------------------------------------------------------------
 * Pull the store's LOGO and a USABLE, WARM COLOUR PALETTE out of the ingested site
 * HTML so the generated funnel visually matches the brand — a bespoke identity, not
 * a dull one-near-black wash. `brandToThemeVars` maps it to the EXACT CSS token
 * vocabulary the component styles read (styles/base.css: --primary/--accent/--surface/
 * …), which the old version didn't — that mismatch is why brand styling barely showed.
 *
 * Pure/Node-safe: HTML in, `{ logo, colors }` out; relative URLs resolved against the
 * origin. Best-effort with warm, high-contrast fallbacks — never throws.
 */

const HEX_RE = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const WARM_ACCENT = "#c8a24a"; // premium gold — a tasteful warm fallback that always pops

function _abs(url, origin) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || /^data:/i.test(url)) return url;
  try { return new URL(url, origin).href; } catch { return url; }
}

function _meta(html, name) {
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
  const img = (html.match(/<img[^>]+(?:class|alt|src)=["'][^"']*logo[^"']*["'][^>]*>/i) || [])[0];
  if (img) { const s = img.match(/src=["']([^"']+)["']/i); if (s) return _abs(s[1], origin); }
  return "";
}

/* ---- tiny colour maths (all pure, hex in/out) ----------------------------- */
function _rgb(hex) {
  let h = String(hex).replace("#", "").toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function _hex(r, g, b) {
  const c = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
export function lum(hex) { const [r, g, b] = _rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
export function sat(hex) {
  const [r, g, b] = _rgb(hex).map((x) => x / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn, l = (mx + mn) / 2;
  return l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
}
function _hue(hex) {
  const [r, g, b] = _rgb(hex).map((x) => x / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
}
/** Shade toward black (amt<0) or white (amt>0), amt in -1..1. */
export function shade(hex, amt) {
  const [r, g, b] = _rgb(hex), f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  return _hex(r + (f - r) * p, g + (f - g) * p, b + (f - b) * p);
}
/** Mix hex1 toward hex2 by weight w (0..1). */
export function mix(hex1, hex2, w) {
  const a = _rgb(hex1), b = _rgb(hex2);
  return _hex(a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w);
}
export function rgba(hex, alpha) { const [r, g, b] = _rgb(hex); return `rgba(${r}, ${g}, ${b}, ${alpha})`; }
const _norm = (hex) => { let h = String(hex).replace("#", "").toLowerCase(); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return "#" + h; };

/**
 * @param {string} html   the ingested start-page HTML
 * @param {string} origin the site origin (for resolving relative asset URLs)
 * @returns {{ logo:string, colors:{ primary:string, accent:string, bg:string, text:string } }}
 */
export function extractBrand(html, origin = "") {
  const src = typeof html === "string" ? html : "";
  const logo = _logo(src, origin);

  const themeColor = _meta(src, "theme-color");
  const counts = new Map();
  let m;
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(src)) !== null) { const hex = _norm(m[0]); counts.set(hex, (counts.get(hex) || 0) + 1); }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const vivid = ranked.filter((h) => { const l = lum(h); return l > 0.06 && l < 0.94; });

  // PRIMARY: the brand's signature deep colour (buttons/headings). theme-color first.
  let primary = _norm(themeColor && /^#[0-9a-f]{3,6}$/i.test(themeColor.trim()) ? themeColor.trim() : (vivid[0] || "#243244"));
  if (lum(primary) > 0.82) primary = shade(primary, -0.45); // too pale to anchor → deepen

  // ACCENT: a warm, saturated colour that POPS. Prefer a real saturated brand hex with
  // a hue distinct from primary; else fall back to premium gold — never a near-black.
  const bySat = vivid.slice().sort((a, b) => sat(b) - sat(a));
  let accent = bySat.find((h) => sat(h) >= 0.4 && Math.abs(_hue(h) - _hue(primary)) > 20)
    || bySat.find((h) => sat(h) >= 0.45)
    || WARM_ACCENT;
  if (lum(accent) < 0.28) accent = shade(accent, 0.4);  // too dark → lift so it reads on cream
  if (lum(accent) > 0.86) accent = shade(accent, -0.3); // too light → deepen
  // Monochrome site (accent ~= primary and dull) → use the warm default so it isn't a wash.
  if (sat(accent) < 0.22 || Math.abs(lum(accent) - lum(primary)) < 0.12) accent = WARM_ACCENT;

  // BACKGROUND: the store's own light background if it has one, else a warm cream.
  const bg = ranked.find((h) => lum(h) >= 0.93) || "#faf7f1";
  const text = "#22262e";

  return { logo, colors: { primary, accent, bg, text } };
}

/**
 * Map a brand profile to engine `themeVars` — the SAME token vocabulary styles/base.css
 * reads, so the palette actually drives the funnel (ADR-0033). Shades are derived so a
 * single brand colour yields a coherent, high-contrast premium set.
 */
export function brandToThemeVars(brand) {
  const c = (brand && brand.colors) || {};
  const primary = c.primary || "#243244";
  const accent = c.accent || WARM_ACCENT;
  const bg = c.bg || "#faf7f1";
  const text = c.text || "#22262e";
  const onPrimary = lum(primary) < 0.6 ? "#ffffff" : "#1a1a1a";

  return {
    "--bg": bg,
    "--surface": "#ffffff",
    "--surface-2": mix(bg, text, 0.05),
    "--border": rgba(text, 0.12),
    "--border-accent": rgba(accent, 0.42),
    "--text": text,
    "--text-muted": mix(text, bg, 0.42),
    "--text-soft": mix(text, bg, 0.24),
    "--primary": primary,
    "--primary-2": shade(primary, -0.14),
    "--on-primary": onPrimary,
    "--accent": accent,
    "--accent-soft": rgba(accent, 0.14),
    "--price": lum(accent) < 0.5 ? accent : shade(accent, -0.25),
  };
}
