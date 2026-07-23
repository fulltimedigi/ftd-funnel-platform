/**
 * netlify/functions/generate-background.mjs — the heavy AI authoring job (ADR-0029).
 * A Netlify BACKGROUND function (the `-background` suffix) → may run up to 15 min,
 * so Opus 4.8 authoring a rich design isn't bound by the ~26s sync limit. Runs
 * generateFunnelFromUrl with the AI enricher and writes the result to Blobs (the
 * per-store design cache). Honest fallback preserved: on AI failure the stored
 * result is the deterministic funnel with the real ai.reason.
 */

import { generateFunnelFromUrl } from "../../authoring/index.js";
import { runJob } from "../../platform/jobs/generateJob.js";
import { createBlobStore } from "../../platform/jobs/blobStore.js";
import { buildEnricher } from "./lib/enricher.mjs";

export const handler = async (event = {}) => {
  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "bad-json" }; }
  const { id, url, goal } = input;
  if (!id || !url) return { statusCode: 400, body: "missing id/url" };

  const store = await createBlobStore();
  const generate = (u) => generateFunnelFromUrl(u, { authorized: true, goal: goal || undefined, enrich: buildEnricher() });

  await runJob({ id, url, store, generate });
  return { statusCode: 200, body: "" }; // background result is ignored by Netlify
};

export default handler;
