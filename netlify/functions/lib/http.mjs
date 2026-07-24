/**
 * netlify/functions/lib/http.mjs — shared CORS + JSON + preflight + token helpers.
 * ---------------------------------------------------------------------------
 * The submit/status functions had identical CORS/JSON/token boilerplate (ADR-0032).
 * Centralized here so the first-party origin allowlist and the interim token gate live
 * in ONE place. `makeHttp(methods)` returns handlers bound to that endpoint's methods.
 */

import { safeEqual } from "../../../platform/security/secrets.js";

const ALLOWED_ORIGINS = (process.env.FTD_ALLOWED_ORIGINS || "https://ftd-studio-preview.netlify.app,https://fulltimedigi.com,https://www.fulltimedigi.com").split(",").map((s) => s.trim()).filter(Boolean);

export function makeHttp(methods) {
  const cors = (event) => {
    const o = event && event.headers && (event.headers.origin || event.headers.Origin);
    const allow = o && ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0];
    return {
      "Access-Control-Allow-Origin": allow,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": "Content-Type, x-ftd-token",
    };
  };
  const json = (event, statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(event) }, body: JSON.stringify(body) });
  const preflight = (event) => ({ statusCode: 204, headers: cors(event), body: "" });
  return { cors, json, preflight };
}

/** PUBLIC endpoint gate (ADR-0032/0040): ENFORCE-ONLY-WHEN-CONFIGURED — deliberately NOT fail-closed.
 *  FTD_PUBLIC_TOKEN is OPTIONAL friction, not real auth: submit/status are public self-service
 *  endpoints whose browsers cannot carry a real secret, so a default-deny here would 401 every real
 *  visitor and break the public UI. When the token IS set it is enforced (constant-time); when unset
 *  the public endpoints stay open. Abuse of these public endpoints is bounded instead by the daily
 *  cost cap (CAS), the SSRF guard, unguessable HMAC job ids, and the fail-closed INTERNAL secret on
 *  the background function — see ADR-0040. (Real public rate-limiting/captcha is a future item.) */
export function tokenOk(event) {
  const need = process.env.FTD_PUBLIC_TOKEN;
  if (!need) return true; // not configured → do not block the public UI (NO default-deny on the public gate)
  const got = event && event.headers && (event.headers["x-ftd-token"] || event.headers["X-Ftd-Token"]);
  return safeEqual(String(got || ""), need);
}
