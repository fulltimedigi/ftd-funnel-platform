/**
 * platform/auth/supabaseClient.js — a tiny, dependency-free Supabase client for
 * the browser (GoTrue auth + PostgREST), built on the pure authModel.
 * ---------------------------------------------------------------------------
 * WHY no @supabase/supabase-js: the platform CSP is `script-src 'self'` (no CDN
 * scripts) and the project is deliberately self-contained. `connect-src https:`
 * already allows talking to Supabase, so we speak its REST API directly with
 * fetch — no library, no build step. The publishable key is public; RLS protects
 * the data. The secret key is NEVER used here.
 *
 * MVP auth = email magic-link / OTP only. Session is persisted in localStorage
 * and auto-refreshed when near expiry.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseConfig.js";
import {
  SESSION_KEY, isValidEmail, parseSession, isExpired, isSessionShape, authHeaders, restHeaders,
} from "./authModel.js";

const nowSec = () => Math.floor(Date.now() / 1000);

/* ------------------------------------------------------------- session I/O -- */
function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return isSessionShape(s) ? s : null;
  } catch { return null; }
}
function writeStored(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

/** Synchronous best-guess (no refresh) — for cheap "is there a session?" checks. */
export function peekSession() { return readStored(); }

/** Human-readable error out of a GoTrue / PostgREST error body. */
async function readError(res, fallback) {
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  const msg = body && (body.error_description || body.msg || body.message || body.error || body.hint);
  return new Error(msg || fallback || ("HTTP " + res.status));
}

/* ----------------------------------------------------------------- auth ---- */

/** Send a one-time login code (and magic link) to the email. Creates the user if new. */
export async function signInWithOtp(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!isValidEmail(e)) throw new Error("البريد الإلكتروني غير صحيح.");
  const res = await fetch(SUPABASE_URL + "/auth/v1/otp", {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: e, create_user: true }),
  });
  if (!res.ok) throw await readError(res, "تعذّر إرسال الرمز. حاول تاني.");
  return { ok: true, email: e };
}

/** Verify the 6-digit code, persist the session, and return it. */
export async function verifyOtp(email, token) {
  const e = String(email || "").trim().toLowerCase();
  const code = String(token || "").trim();
  if (!code) throw new Error("اكتب الرمز اللي وصلك على الإيميل.");
  const res = await fetch(SUPABASE_URL + "/auth/v1/verify", {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "email", email: e, token: code }),
  });
  if (!res.ok) throw await readError(res, "الرمز غير صحيح أو انتهت صلاحيته.");
  const session = parseSession(await res.json(), nowSec());
  if (!session) throw new Error("تعذّر إنشاء الجلسة.");
  writeStored(session);
  return session;
}

/** Exchange the refresh token for a fresh session. Never throws: a bad response
 *  OR a network failure returns null (a transient blip leaves the stored session
 *  intact so a later call can retry; an explicit auth failure clears it). */
export async function refresh() {
  const cur = readStored();
  if (!cur || !cur.refresh_token) return null;
  let res;
  try {
    res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: cur.refresh_token }),
    });
  } catch { return null; } // network error → keep the session, let the caller retry
  if (!res.ok) { writeStored(null); return null; } // rejected token → clear
  const session = parseSession(await res.json(), nowSec());
  writeStored(session);
  return session;
}

/** The current VALID session (auto-refreshing if near expiry), or null. */
export async function getSession() {
  const cur = readStored();
  if (!cur) return null;
  if (!isExpired(cur, nowSec())) return cur;
  return await refresh();
}

/** Best-effort server logout + local clear. */
export async function signOut() {
  const cur = readStored();
  if (cur) {
    try {
      await fetch(SUPABASE_URL + "/auth/v1/logout", {
        method: "POST", headers: authHeaders(SUPABASE_ANON_KEY, cur),
      });
    } catch { /* ignore network */ }
  }
  writeStored(null);
}

/* --------------------------------------------------------------- data API -- */

async function authed() {
  const s = await getSession();
  if (!s) throw new Error("محتاج تسجّل الدخول الأول.");
  return s;
}

/** Atomically save a generated funnel (funnel + first version) → returns funnel id. */
export async function createFunnel({ storeUrl, artifact, name = null, catalogVersion = null, policyVersion = null }) {
  const s = await authed();
  const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/create_funnel", {
    method: "POST",
    headers: restHeaders(SUPABASE_ANON_KEY, s),
    body: JSON.stringify({
      _store_url: storeUrl, _artifact: artifact, _name: name,
      _catalog_version: catalogVersion, _policy_version: policyVersion,
    }),
  });
  if (!res.ok) throw await readError(res, "تعذّر حفظ الفانل.");
  return await res.json(); // the new funnel uuid
}

/** The signed-in user's funnels, newest first (RLS scopes to their tenant). */
export async function listFunnels() {
  const s = await authed();
  const cols = "id,name,store_url,status,created_at,updated_at,current_version_id";
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/funnels?select=" + encodeURIComponent(cols) + "&order=updated_at.desc",
    { headers: restHeaders(SUPABASE_ANON_KEY, s) },
  );
  if (!res.ok) throw await readError(res, "تعذّر تحميل الفانلات.");
  return await res.json();
}

/** Rename a funnel (RLS ensures it's the caller's). */
export async function renameFunnel(id, name) {
  const s = await authed();
  const res = await fetch(SUPABASE_URL + "/rest/v1/funnels?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: restHeaders(SUPABASE_ANON_KEY, s, { Prefer: "return=representation" }),
    body: JSON.stringify({ name: name }),
  });
  if (!res.ok) throw await readError(res, "تعذّر إعادة التسمية.");
  const rows = await res.json();
  return rows && rows[0];
}

/** Delete a funnel (cascades to its versions; RLS ensures it's the caller's). */
export async function deleteFunnel(id) {
  const s = await authed();
  const res = await fetch(SUPABASE_URL + "/rest/v1/funnels?id=eq." + encodeURIComponent(id), {
    method: "DELETE",
    headers: restHeaders(SUPABASE_ANON_KEY, s),
  });
  if (!res.ok) throw await readError(res, "تعذّر الحذف.");
  return true;
}

/** The latest saved artifact (config JSON) for a funnel — used to re-open it. */
export async function getFunnelArtifact(funnelId) {
  const s = await authed();
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/funnel_versions?select=artifact&funnel_id=eq." +
      encodeURIComponent(funnelId) + "&order=created_at.desc&limit=1",
    { headers: restHeaders(SUPABASE_ANON_KEY, s) },
  );
  if (!res.ok) throw await readError(res, "تعذّر فتح الفانل.");
  const rows = await res.json();
  return rows && rows[0] ? rows[0].artifact : null;
}

export default {
  peekSession, getSession, signInWithOtp, verifyOtp, refresh, signOut,
  createFunnel, listFunnels, renameFunnel, deleteFunnel, getFunnelArtifact,
};
