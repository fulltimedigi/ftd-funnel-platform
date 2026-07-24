/**
 * platform/jobs/generateJob.js — async generation job core (ADR-0029).
 * ---------------------------------------------------------------------------
 * Pure orchestration for submit → background-run → poll, with a per-store design
 * cache keyed by a hash of the normalized URL. The Blobs store and the heavy
 * `generate` step are INJECTED, so the whole flow (cache hit, trigger, run,
 * honest fallback) is unit-tested with a Map-backed fake — no Netlify, no network.
 */

import { createHash } from "node:crypto";
import { normalizeUrl } from "../intake/intakeModel.js";

/** Stable job id / cache key: sha256(SALT | normalized url), first 32 hex chars.
 *  The salt is a server secret (FTD_ID_SALT), so a job id — and thus its cached
 *  result — cannot be derived by guessing the URL (ADR-0032). Same salt + same URL →
 *  same key, so the per-store design cache still works. */
export function keyFor(url, salt) {
  const s = salt != null ? salt : ((typeof process !== "undefined" && process.env && process.env.FTD_ID_SALT) || "");
  const norm = normalizeUrl(url) || String(url || "").trim().toLowerCase();
  return createHash("sha256").update(s + "|" + norm).digest("hex").slice(0, 32);
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
/** A pending job younger than this is treated as in-flight (don't re-trigger). */
export const IN_FLIGHT_MS = 4 * 60 * 1000;

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
