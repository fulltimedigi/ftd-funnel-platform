/**
 * platform/intake/intakeModel.js — Pure intake validation for the paste-URL
 * screen (ADR-0024).
 * ---------------------------------------------------------------------------
 * The one input that matters is the brand/store URL; the business goal is the one
 * optional thing worth asking (PRODUCT_DECISIONS §1). This normalizes + validates
 * that input honestly BEFORE any generation runs. Pure — no DOM, no network —
 * fully unit-tested; the screen is a thin renderer over it.
 */

import { assertUrlAllowed } from "../../authoring/ingest/ssrfGuard.js";

/** Production ⇒ localhost is dropped (SSRF). Dev/tests keep it for the local sample. */
const isProd = () => typeof process !== "undefined" && !!process.env && process.env.NODE_ENV === "production";

/** Add a scheme if missing, trim, and lower-case the host. Returns "" if unusable or
 *  unsafe (private / link-local / *.internal / metadata / — in production — localhost). */
export function normalizeUrl(raw, opts = {}) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s; // bare "brand.com" → https://brand.com
  let u;
  try { u = new URL(s); } catch { return ""; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  const host = u.hostname.toLowerCase();
  // A real host has a dot (brand.com) — or is localhost (our own sample/dev). This
  // already rejects bare IP literals (no letter TLD).
  if (host !== "localhost" && !/\.[a-z]{2,}$/i.test(host)) return "";
  u.hostname = host;
  // SSRF guard (ADR-0032): block internal/metadata always; localhost only in production.
  const allowLocalhost = opts.allowLocalhost != null ? opts.allowLocalhost : !isProd();
  if (!assertUrlAllowed(u.href, { allowLocalhost }).ok) return "";
  return u.href;
}

/**
 * Validate the paste-screen input.
 * @param {{url:string, goal?:string}} input
 * @returns {{ok:true, request:{url:string, goal:string|null}} | {ok:false, reason:string}}
 */
export function buildIntake(input = {}) {
  const url = normalizeUrl(input.url);
  if (!url) return { ok: false, reason: "invalid-url" };
  const goalRaw = typeof input.goal === "string" ? input.goal.trim() : "";
  return { ok: true, request: { url, goal: goalRaw ? goalRaw.slice(0, 200) : null } };
}
