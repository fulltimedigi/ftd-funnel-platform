/**
 * platform/configSource.js — safe resolution of the `?config=` / `?funnel=` parameters (ADR-0040).
 * ---------------------------------------------------------------------------
 * The Studio review page and the embed funnel accept a config source from the query string. The old
 * check accepted ANY absolute `https://…` URL, so an attacker could render arbitrary attacker-hosted
 * content UNDER our trusted origin (content spoofing / a convincing phishing surface on our domain).
 *
 * The fix: a `?config` value is honoured ONLY when it is a SAME-ORIGIN RELATIVE path — no scheme
 * (rejects http:/https:/data:/javascript:…), no protocol-relative `//host`, no backslash tricks — and
 * it must still resolve to the page's own origin. Any scheme-bearing or cross-origin value is rejected
 * (relative-only is the tightest posture and matches how the app actually links configs).
 * `?funnel=<id>` remains an allow-listed id. Pure + dependency-free; unit-tested and shared by both pages.
 */

/** A funnel id must be a short kebab/alnum slug (never a path or a URL). */
export function safeFunnelId(raw) {
  const id = String(raw || "").trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(id) ? id : null;
}

/**
 * Return a SAME-ORIGIN config path, or null. `base`/`origin` come from the page (location.href /
 * location.origin); they are injectable for tests.
 */
export function safeConfigPath(raw, base, origin) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;   // reject any scheme (http:, data:, javascript:…)
  if (s.startsWith("//") || s.includes("\\")) return null; // reject protocol-relative + backslash tricks
  let u;
  try { u = new URL(s, base); } catch { return null; }
  if (u.origin !== origin) return null;               // must stay on OUR origin
  return s;                                            // safe: the original same-origin relative path
}

/**
 * Resolve the query string to a config source. Order: draft flag → same-origin ?config → ?funnel id.
 * @param {string} search   location.search
 * @param {{href:string, origin:string, funnelBase:string}} ctx  page href/origin + the configs/ base
 * @returns {{draft?:true}|{configUrl:string, preview:string, funnelId:?string}|null}
 */
export function resolveConfigSource(search, ctx) {
  const q = new URLSearchParams(search || "");
  if (q.get("draft")) return { draft: true, preview: "draft=1", funnelId: null };
  const cfg = safeConfigPath(q.get("config"), ctx.href, ctx.origin);
  if (cfg) return { configUrl: cfg, preview: "config=" + encodeURIComponent(cfg), funnelId: null };
  const id = safeFunnelId(q.get("funnel"));
  if (id) return { configUrl: ctx.funnelBase + id + ".json", preview: "funnel=" + id, funnelId: id };
  return null;
}

export default { safeFunnelId, safeConfigPath, resolveConfigSource };
