/**
 * netlify/functions/generate-background.mjs — the heavy AI authoring job (ADR-0029/0032).
 * A Netlify BACKGROUND function (may run up to 15 min) so Opus 4.8 authoring isn't bound
 * by the ~26s sync limit. Locked down: it requires an internal shared secret (set by the
 * submit trigger) so it can't be invoked externally, and the whole handler is wrapped so
 * ANY failure writes an honest {status:"error"} record instead of leaving a perpetual
 * "pending". The write key is derived server-side (keyFor with the secret salt), never
 * from raw caller input.
 */

import { generateFunnelFromUrl } from "../../authoring/index.js";
import { runJob, keyFor } from "../../platform/jobs/generateJob.js";
import { createBlobStore } from "../../platform/jobs/blobStore.js";
import { buildEnricher } from "./lib/enricher.mjs";
import { requireSecret, safeEqual } from "../../platform/security/secrets.js";

export const handler = async (event = {}) => {
  // FAIL-CLOSED (ADR-0040): only the internal caller (generate-submit) may invoke this heavy,
  // uncapped Opus job. In production a MISSING FTD_INTERNAL_SECRET is a hard refusal (503) — never
  // a silently-skipped check that leaves the endpoint open to any external POST. Dev/local may run
  // lenient (with a loud warning). When the secret IS set, the header must match in constant time.
  const secret = requireSecret("FTD_INTERNAL_SECRET");
  if (!secret.ok) {
    if (secret.prod) return { statusCode: 503, body: "unconfigured" }; // prod + no secret → refuse before any work
    // non-prod: fall through (warning already emitted) so local dev still works
  } else {
    const got = event.headers && (event.headers["x-ftd-internal"] || event.headers["X-Ftd-Internal"]);
    if (!safeEqual(String(got || ""), secret.value)) return { statusCode: 401, body: "unauthorized" };
  }

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "bad-json" }; }
  const { url, goal } = input;
  if (!url) return { statusCode: 400, body: "missing url" };
  const id = keyFor(url); // derive the write key ourselves (salt + url), not from caller input

  let store = null;
  try {
    store = await createBlobStore();
    const generate = (u) => generateFunnelFromUrl(u, { authorized: true, goal: goal || undefined, enrich: buildEnricher() });
    await runJob({ id, url, store, generate });
  } catch (e) {
    // Honest failure — never a perpetual "pending". Record the real state for the poller.
    try { if (store) await store.set(id, { status: "error", url, reason: "storage-unavailable", detail: String((e && e.name) || e) }); } catch { /* best effort */ }
  }
  return { statusCode: 200, body: "" }; // background result is ignored by Netlify
};

export default handler;
