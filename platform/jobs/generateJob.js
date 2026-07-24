/**
 * platform/jobs/generateJob.js — async generation job core (ADR-0029).
 * ---------------------------------------------------------------------------
 * Pure orchestration for submit → background-run → poll, with a per-store design
 * cache keyed by a hash of the normalized URL. The Blobs store and the heavy
 * `generate` step are INJECTED, so the whole flow (cache hit, trigger, run,
 * honest fallback) is unit-tested with a Map-backed fake — no Netlify, no network.
 */

import { createHmac } from "node:crypto";
import { normalizeUrl } from "../intake/intakeModel.js";
import { isProd, warnMissingSecret } from "../security/secrets.js";

// A non-secret DEV fallback salt (ADR-0040). NEVER used in production — there a missing
// FTD_ID_SALT is a hard error. It only keeps local/test hashing deterministic AND keyed
// (never keyed by the empty string, which would be guessable).
const DEV_FALLBACK_SALT = "ftd-dev-insecure-salt";

/** Stable job id / cache key: HMAC-SHA256(SALT, normalized url), first 32 hex chars (ADR-0040).
 *  An HMAC keyed by the server secret FTD_ID_SALT — not a plain hash of salt+url — so the id (and
 *  thus its cached result) cannot be derived by guessing the URL, and cannot be forged without the
 *  key. The salt is MANDATORY in production: a missing salt THROWS rather than falling back to the
 *  empty string (which was guessable). Dev/local uses a loud, fixed non-secret fallback so tests stay
 *  deterministic. Same salt + same URL → same key, so the per-store design cache still works. */
export function keyFor(url, salt) {
  let s = salt != null ? salt : ((typeof process !== "undefined" && process.env && process.env.FTD_ID_SALT) || "");
  if (!s) {
    if (isProd()) throw new Error("FTD_ID_SALT is required in production (fail-closed job-id keying)");
    warnMissingSecret("FTD_ID_SALT");
    s = DEV_FALLBACK_SALT; // never HMAC with an empty key
  }
  const norm = normalizeUrl(url) || String(url || "").trim().toLowerCase();
  return createHmac("sha256", s).update(norm).digest("hex").slice(0, 32);
}

/**
 * Reserve one slot of a daily counter ATOMICALLY (ADR-0040). The old get→compare→set was a
 * TOCTOU race: concurrent submits each read the same count and each wrote count+1, so the daily
 * cost cap (the ONLY guard before an Opus call) was trivially overrun. This uses the store's
 * compare-and-swap (getWithMeta + setIfMatch) with bounded retries; on a lost race it retries with
 * the fresh ETag, and if it still can't win under heavy contention it FAILS CLOSED (denies).
 * @returns {Promise<boolean>} true = a slot was reserved (proceed); false = cap reached or contention.
 */
export async function reserveDailySlot({ store, key, cap, now = Date.now, maxRetries = 5 }) {
  const day = new Date(now()).toISOString().slice(0, 10);
  // If the store lacks CAS (a minimal fake), fall back to non-atomic — but only in non-prod.
  if (typeof store.getWithMeta !== "function" || typeof store.setIfMatch !== "function") {
    const rec = (await store.get(key)) || { count: 0, day };
    if (rec.count >= cap) return false;
    await store.set(key, { count: rec.count + 1, day });
    return true;
  }
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const cur = await store.getWithMeta(key);
    const rec = (cur && cur.value) || { count: 0, day };
    if (rec.count >= cap) return false;                       // cap reached → deny
    const res = await store.setIfMatch(key, { count: rec.count + 1, day }, cur && cur.etag);
    if (res && res.ok) return true;                           // won the CAS → reserved
    // else: lost the race (someone else incremented) → loop with the fresh ETag
  }
  return false; // couldn't reserve under contention → fail closed (deny rather than risk over-spend)
}

/** A fixed-window rate-limit key: scope + id + the current window bucket (so the counter
 *  auto-resets each window without any cleanup step). */
export function windowKey(scope, id, windowMs, now = Date.now) {
  const bucket = Math.floor(now() / windowMs);
  return `rl:${scope}:${id}:${bucket}`;
}

/**
 * Reserve one slot in a PER-KEY fixed window, ATOMICALLY. Reuses reserveDailySlot's CAS so
 * concurrent requests from the same key can't race past the cap. This is the per-IP / per-user
 * abuse limiter that sits IN FRONT of the global daily cost cap: a single client can burn only
 * its own small budget, so it can't exhaust the shared budget or hammer the Opus path.
 * @returns {Promise<boolean>} true = reserved (proceed); false = cap reached / contention (deny).
 */
export async function reserveRateSlot({ store, scope, id, cap, windowMs, now = Date.now }) {
  return reserveDailySlot({ store, key: windowKey(scope, id, windowMs, now), cap, now });
}

/** Shape the record we persist from a generateFunnelFromUrl result. */
export function recordFrom(res, url) {
  if (res && res.ok) {
    return {
      status: "ready", url,
      config: res.config,
      source: res.source || null,
      trust: res.trust || null,
      bland: res.bland || null,
      richness: res.richness || null,
      ai: res.ai || null,
      catalog: { origin: res.catalog && res.catalog.origin, count: (res.catalog && res.catalog.products && res.catalog.products.length) || 0 },
    };
  }
  return { status: "error", url, stage: res && res.stage, reason: (res && res.reason) || "generation-failed", ai: res && res.ai || null };
}

/**
 * Submit a URL for generation. Returns the job id + whether it's already ready
 * (cache hit) or now pending. Requires an injected `store` ({get,set}) and a
 * `trigger(key, url)` that kicks off the background run (fire-and-forget).
 * @returns {Promise<{ok:true, id, status:'ready'|'pending', cached?:boolean} | {ok:false, reason}>}
 */
/** A pending job younger than this is treated as in-flight (don't re-trigger). MUST be ≥ the
 *  background function's max runtime (Netlify background fns run up to 15 min) so a still-running
 *  job is never re-triggered into a concurrent double-generation (ADR-0040). 16 min > 15 min. */
export const IN_FLIGHT_MS = 16 * 60 * 1000;

export async function submitJob({ url, regenerate = false, store, trigger, guard, now = Date.now }) {
  const norm = normalizeUrl(url);
  if (!norm) return { ok: false, reason: "invalid-url" };
  const id = keyFor(norm);

  const existing = await store.get(id);
  if (existing && existing.status === "ready" && !regenerate) {
    return { ok: true, id, status: "ready", cached: true };
  }
  // De-dupe concurrent submits (ADR-0032): a fresh pending record means a job is already
  // running — just let the caller poll it instead of spending another Opus run.
  if (existing && existing.status === "pending" && !regenerate && existing.startedAt && (now() - existing.startedAt) < IN_FLIGHT_MS) {
    return { ok: true, id, status: "pending", inFlight: true };
  }
  // Abuse/cost cap BEFORE any expensive generation (ADR-0032). Cache hits / in-flight
  // above never reach here. `guard()` returns false when the daily budget is spent.
  if (typeof guard === "function" && !(await guard())) return { ok: false, reason: "rate-limited" };

  await store.set(id, { status: "pending", url: norm, startedAt: now() });
  if (typeof trigger === "function") {
    try {
      await trigger(id, norm);
    } catch (e) {
      // Honest failure — never a silent pending that polls forever (ADR-0032).
      await store.set(id, { status: "error", url: norm, reason: "trigger-failed", detail: String((e && e.message) || e) });
      return { ok: true, id, status: "error", reason: "trigger-failed" };
    }
  }
  return { ok: true, id, status: "pending" };
}

/** Poll a job by id. */
export async function statusJob({ id, store }) {
  if (!id) return { status: "unknown" };
  const rec = await store.get(id);
  return rec || { status: "unknown" };
}

/**
 * Run the heavy generation for a job and persist the result. `generate(url)` is
 * injected (the real one calls generateFunnelFromUrl with the AI enricher). Honest
 * fallback is inherited: generate() returns the deterministic funnel with the real
 * ai.reason when the AI path fails — we store exactly that, never a fake-rich one.
 */
export async function runJob({ id, url, store, generate }) {
  let res;
  try { res = await generate(url); }
  catch (e) { res = { ok: false, stage: "run", reason: "threw", ai: { error: String((e && e.message) || e) } }; }
  const record = recordFrom(res, url);
  await store.set(id, record);
  return record;
}
