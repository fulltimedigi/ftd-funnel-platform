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

export const handler = async (event = {}) => {
  // Only the internal caller (generate-submit) may invoke this — external POSTs are
  // rejected when the secret is configured (ADR-0032).
  const internal = process.env.FTD_INTERNAL_SECRET || "";
  if (internal) {
    const got = event.headers && (event.headers["x-ftd-internal"] || event.headers["X-Ftd-Internal"]);
    if (got !== internal) return { statusCode: 401, body: "unauthorized" };
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
