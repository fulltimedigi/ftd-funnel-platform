/**
 * platform/auth/authModel.js — PURE auth logic (no DOM, no network, no clock).
 * ---------------------------------------------------------------------------
 * The testable core beneath the browser client: email validation, GoTrue token
 * normalization, expiry math, and header construction. Every function that needs
 * "now" takes it as a parameter (seconds) so there is no Date.now() inside —
 * deterministic and Node-unit-testable, matching the rest of the platform.
 *
 * The MVP auth method is EMAIL magic-link / OTP only (operator decision). These
 * helpers are method-agnostic, so anonymous/OAuth can layer on later unchanged.
 */

/** localStorage key for the persisted session (single-account MVP). */
export const SESSION_KEY = "ftd:auth-session";

/** Conservative email check — good enough to gate a "send code" call. */
export function isValidEmail(raw) {
  const s = String(raw || "").trim();
  if (s.length < 3 || s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/**
 * Normalize a GoTrue token response into the session we persist.
 * @param {object} tok  { access_token, refresh_token, expires_in, expires_at, user }
 * @param {number} nowSec  current unix time in seconds
 * @returns {object|null}  { access_token, refresh_token, expires_at, user } or null
 */
export function parseSession(tok, nowSec) {
  if (!tok || typeof tok !== "object") return null;
  if (!tok.access_token || !tok.refresh_token) return null;
  const expiresAt =
    Number(tok.expires_at) ||
    (Number.isFinite(nowSec) && Number(tok.expires_in) ? Math.floor(nowSec) + Number(tok.expires_in) : 0);
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: expiresAt,
    user: tok.user ? { id: tok.user.id, email: tok.user.email } : null,
  };
}

/** True when the session is missing/malformed or within `skewSec` of expiry. */
export function isExpired(session, nowSec, skewSec = 60) {
  if (!session || !session.access_token || !session.expires_at) return true;
  return Math.floor(nowSec) >= Number(session.expires_at) - skewSec;
}

/** Shape check for a persisted session. */
export function isSessionShape(s) {
  return !!(s && typeof s === "object" && s.access_token && s.refresh_token && s.expires_at);
}

/**
 * Headers for a GoTrue auth request. `apikey` is always required; the bearer is
 * the anon key for pre-login calls (otp/verify) and the user's access token once
 * signed in.
 */
export function authHeaders(anonKey, session) {
  const bearer = session && session.access_token ? session.access_token : anonKey;
  return { apikey: anonKey, Authorization: "Bearer " + bearer, "Content-Type": "application/json" };
}

/**
 * Headers for a PostgREST / RPC request as the signed-in user. RLS uses the JWT,
 * so a call without a session is refused here (never silently sent as anon).
 * @param {object} extra  merged last (e.g. { Prefer: "return=representation" })
 */
export function restHeaders(anonKey, session, extra = {}) {
  if (!isSessionShape(session)) throw new Error("authModel.restHeaders: a signed-in session is required");
  return {
    apikey: anonKey,
    Authorization: "Bearer " + session.access_token,
    "Content-Type": "application/json",
    ...extra,
  };
}

export default { SESSION_KEY, isValidEmail, parseSession, isExpired, isSessionShape, authHeaders, restHeaders };
