/**
 * netlify/functions/generate-submit.mjs — submit a URL for async generation (ADR-0029/0032).
 * Normalize + validate + SSRF-check → cache key. Cache hit → {status:"ready"} instantly;
 * else check the abuse/cost cap, mark pending, trigger the background job (with an
 * internal shared secret so the heavy fn can't be invoked externally), return pending.
 */

import { buildIntake } from "../../platform/intake/intakeModel.js";
import { submitJob } from "../../platform/jobs/generateJob.js";
import { createBlobStore } from "../../platform/jobs/blobStore.js";
import { assertUrlAllowed } from "../../authoring/ingest/ssrfGuard.js";
import { makeHttp, tokenOk } from "./lib/http.mjs";

const { cors, json, preflight } = makeHttp("POST, OPTIONS");
const DAILY_CAP = Number(process.env.FTD_DAILY_CAP || 200);

/** Global daily generation cap (a counter in Blobs) — before any Opus call. */
async function underDailyCap(store) {
  const day = new Date().toISOString().slice(0, 10);
  const key = "spend:" + day;
  const rec = (await store.get(key)) || { count: 0, day };
  if (rec.count >= DAILY_CAP) return false;
  await store.set(key, { count: rec.count + 1, day });
  return true;
}

export const handler = async (event = {}) => {
  const method = event.httpMethod;
  if (method === "OPTIONS") return preflight(event);
  if (method !== "POST") return json(event, 405, { ok: false, reason: "method-not-allowed" });
  if (!tokenOk(event)) return json(event, 401, { ok: false, reason: "unauthorized" });

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return json(event, 400, { ok: false, reason: "bad-json" }); }

  const intake = buildIntake({ url: input.url, goal: input.goal });
  if (!intake.ok) return json(event, 400, { ok: false, reason: intake.reason });
  if (input.authorized !== true) return json(event, 403, { ok: false, reason: "not-authorized" });
  // Server-side SSRF gate (localhost never allowed here, even if NODE_ENV isn't prod).
  if (!assertUrlAllowed(intake.request.url, { allowLocalhost: false }).ok) return json(event, 400, { ok: false, reason: "blocked-url" });

  let store;
  try {
    store = await createBlobStore();
    if (!(await store.healthy())) return json(event, 503, { ok: false, reason: "storage-unconfigured" });
  } catch (e) {
    return json(event, 503, { ok: false, reason: "storage-unconfigured", detail: String((e && e.name) || e) });
  }

  // Trigger the background function (returns 202 fast; runs up to 15 min) with the
  // internal shared secret so it can't be invoked from outside (ADR-0032).
  const base = process.env.DEPLOY_PRIME_URL || process.env.URL || (event.headers && ("https://" + event.headers.host)) || "";
  const internal = process.env.FTD_INTERNAL_SECRET || "";
  const trigger = async (id, url) => {
    const res = await fetch(base + "/.netlify/functions/generate-background", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ftd-internal": internal },
      body: JSON.stringify({ id, url, goal: intake.request.goal || null }),
    });
    // Background functions answer 202; treat any non-2xx as a real trigger failure so the
    // job is recorded as errored instead of polling forever (ADR-0032).
    if (res && typeof res.status === "number" && (res.status < 200 || res.status >= 300)) {
      throw new Error("trigger-http-" + res.status);
    }
  };

  const r = await submitJob({
    url: intake.request.url,
    regenerate: input.regenerate === true,
    store,
    trigger,
    guard: () => underDailyCap(store),
  });
  if (!r.ok) return json(event, r.reason === "rate-limited" ? 429 : 400, r);
  return json(event, 200, r);
};

export default handler;
