/**
 * netlify/functions/lib/http.mjs — shared CORS + JSON + preflight + token helpers.
 * ---------------------------------------------------------------------------
 * The submit/status functions had identical CORS/JSON/token boilerplate (ADR-0032).
 * Centralized here so the first-party origin allowlist and the interim token gate live
 * in ONE place. `makeHttp(methods)` returns handlers bound to that endpoint's methods.
 */

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

/** Interim endpoint gate (ADR-0032): enforced only when FTD_PUBLIC_TOKEN is configured. */
export function tokenOk(event) {
  const need = process.env.FTD_PUBLIC_TOKEN;
  if (!need) return true;
  const got = event && event.headers && (event.headers["x-ftd-token"] || event.headers["X-Ftd-Token"]);
  return got === need;
}
