/**
 * platform/security/secrets.js — fail-closed secret helpers (ADR-0040).
 * ---------------------------------------------------------------------------
 * Shared, dependency-free primitives for the "a missing secret must FAIL CLOSED in
 * production" rule. The prior gates were `if (secret) { enforce }` — i.e. an unset
 * secret silently disabled the whole check, so an unconfigured production deploy was
 * wide open. These helpers invert that: in production a missing secret is a hard refusal;
 * only a genuine dev/local context may run lenient, and only with a loud one-time warning.
 *
 * `isProd()` treats every INTERNET-FACING Netlify context (production, deploy-preview,
 * branch-deploy) as production — a public preview can burn the Opus budget just like prod,
 * so it must be fail-closed too. Only CONTEXT==="dev" (netlify dev / local) or, when no
 * Netlify context is present, NODE_ENV!=="production", is treated as non-prod.
 *
 * `safeEqual()` is a constant-time comparison that NEVER leaks length or throws on a
 * length mismatch: it hashes both inputs to fixed-length digests first, then
 * timingSafeEqual on the equal-length digests.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Internet-facing (fail-closed) vs genuine dev/local (may be lenient). */
export function isProd() {
  const ctx = typeof process !== "undefined" && process.env ? process.env.CONTEXT : undefined;
  if (ctx) return ctx !== "dev"; // production | deploy-preview | branch-deploy → prod-like
  return typeof process !== "undefined" && !!process.env && process.env.NODE_ENV === "production";
}

/** Constant-time equality that is safe on unequal lengths and non-strings. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb); // both 32 bytes → never throws, never leaks length
}

const _warned = new Set();
/** Loud, once-per-secret warning that a check is running lenient in non-prod. */
export function warnMissingSecret(name) {
  if (_warned.has(name)) return;
  _warned.add(name);
  try { console.warn(`[ftd-security] ${name} is not set — the check tied to it is DISABLED (non-prod only). Set it before any internet-facing deploy.`); } catch { /* noop */ }
}

/**
 * Resolve a required secret with fail-closed semantics.
 * @returns {{ ok:true, value:string } | { ok:false, prod:boolean }}
 *   ok:false + prod:true  → a production request must be refused (503/401).
 *   ok:false + prod:false → dev/local; caller may run lenient (warn already emitted).
 */
export function requireSecret(name) {
  const value = (typeof process !== "undefined" && process.env && process.env[name]) || "";
  if (value) return { ok: true, value };
  if (isProd()) return { ok: false, prod: true };
  warnMissingSecret(name);
  return { ok: false, prod: false };
}

export default { isProd, safeEqual, warnMissingSecret, requireSecret };
