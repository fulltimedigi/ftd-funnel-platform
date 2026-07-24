/**
 * platform/auth/supabaseConfig.js — public Supabase coordinates for the browser.
 * ---------------------------------------------------------------------------
 * These two values are PUBLIC by design. The publishable key identifies the
 * project; it grants NOTHING on its own — every table is protected by Postgres
 * Row-Level Security (Step A), so the data is safe even though this key ships in
 * the client bundle. The SECRET key (service_role) is NEVER here; it lives only
 * in server-side Netlify env vars and bypasses RLS.
 *
 * A page may override these at runtime via window.__FTD_SUPABASE__ = { url, key }
 * (e.g. to point a staging build at another project) without editing this file.
 */
export const SUPABASE_URL =
  (typeof window !== "undefined" && window.__FTD_SUPABASE__ && window.__FTD_SUPABASE__.url) ||
  "https://kppewqtlaqmezylujxwu.supabase.co";

export const SUPABASE_ANON_KEY =
  (typeof window !== "undefined" && window.__FTD_SUPABASE__ && window.__FTD_SUPABASE__.key) ||
  "sb_publishable_3-BdFvGXc0hjxciAmGLHWw_YhHTlq_n";

export default { SUPABASE_URL, SUPABASE_ANON_KEY };
