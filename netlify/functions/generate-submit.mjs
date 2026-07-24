/**
 * netlify/functions/generate-submit.mjs — submit a URL for async generation (ADR-0029/0032).
 * Normalize + validate + SSRF-check → cache key. Cache hit → {status:"ready"} instantly;
 * else check the abuse/cost cap, mark pending, trigger the background job (with an
 * internal shared secret so the heavy fn can't be invoked externally), return pending.
 */

import { buildIntake } from "../../platform/intake/intakeModel.js";
import { submitJob, reserveDailySlot } from "../../platform/jobs/generateJob.js";
import { createBlobStore } from "../../platform/jobs/blobStore.js";
import { assertUrlAllowed } from "../../authoring/ingest/ssrfGuard.js";
import { makeHttp, tokenOk } from "./lib/http.mjs";
import { requireSecret } from "../../platform/security/secrets.js";

const { cors, json, preflight } = makeHttp("POST, OPTIONS");
const DAILY_CAP = Number(process.env.FTD_DAILY_CAP || 200);

/** The trusted base for the secret-bearing internal trigger (ADR-0040): a server-side env var ONLY.
 *  NEVER derived from event.headers.host — that is attacker-controlled and would leak the secret. */
export function triggerBase(env = (typeof process !== "undefined" && process.env) || {}) {
  return env.DEPLOY_PRIME_URL || env.URL || "";
}

/** Global daily generation cap — ATOMIC compare-and-swap (ADR-0040), so concurrent submits can't
 *  race past the only cost guard before an Opus call. */
async function underDailyCap(store) {
  return reserveDailySlot({ store, key: "spend:" + new Date().toISOString().slice(0, 10), cap: DAILY_CAP });
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

  // MISCONFIG FAIL-FAST (ADR-0040), before touching storage. The background trigger carries
  // FTD_INTERNAL_SECRET, so its target base MUST come from a trusted server-side env var — NEVER from
  // event.headers.host (attacker-controlled; a spoofed Host would exfiltrate the secret). No base, or
  // a missing internal secret in production, is a hard refusal here — never a Host fallback.
  const base = triggerBase();
  if (!base) return json(event, 503, { ok: false, reason: "trigger-unconfigured" });
  const internalSecret = requireSecret("FTD_INTERNAL_SECRET");
  if (!internalSecret.ok && internalSecret.prod) return json(event, 503, { ok: false, reason: "internal-secret-unconfigured" });
  const internal = internalSecret.ok ? internalSecret.value : "";

  let store;
  try {
    store = await createBlobStore();
    if (!(await store.healthy())) return json(event, 503, { ok: false, reason: "storage-unconfigured" });
  } catch (e) {
    return json(event, 503, { ok: false, reason: "storage-unconfigured", detail: String((e && e.name) || e) });
  }

  // Trigger the background function (returns 202 fast; runs up to 15 min) with the internal shared
  // secret so it can't be invoked from outside (ADR-0032).
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
