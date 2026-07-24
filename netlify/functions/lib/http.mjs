/**
 * netlify/functions/lib/http.mjs — shared CORS + JSON + preflight + token helpers.
 * ---------------------------------------------------------------------------
 * The submit/status functions had identical CORS/JSON/token boilerplate (ADR-0032).
 * Centralized here so the first-party origin allowlist and the interim token gate live
 * in ONE place. `makeHttp(methods)` returns handlers bound to that endpoint's methods.
 */

import { requireSecret, safeEqual } from "../../../platform/security/secrets.js";

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

/** Endpoint gate (ADR-0032/0040): DEFAULT-DENY in production. A missing FTD_PUBLIC_TOKEN denies every
 *  request in an internet-facing deploy (never silently opens the endpoint); dev/local runs lenient
 *  with a loud warning. When configured, the header is compared in constant time. */
export function tokenOk(event) {
  const secret = requireSecret("FTD_PUBLIC_TOKEN");
  if (!secret.ok) return !secret.prod; // prod + no token → DENY; non-prod → allow (warned)
  const got = event && event.headers && (event.headers["x-ftd-token"] || event.headers["X-Ftd-Token"]);
  return safeEqual(String(got || ""), secret.value);
}
