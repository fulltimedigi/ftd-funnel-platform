/**
 * netlify/functions/generate-submit.mjs — submit a URL for async generation (ADR-0029).
 * Normalize + validate → cache key. Cache hit → {status:"ready"} instantly; else
 * mark pending, trigger the background job, return {status:"pending"}. Fast fn.
 */

import { buildIntake } from "../../platform/intake/intakeModel.js";
import { submitJob } from "../../platform/jobs/generateJob.js";
import { createBlobStore } from "../../platform/jobs/blobStore.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }, body: JSON.stringify(body) });

export const handler = async (event = {}) => {
  const method = event.httpMethod;
  if (method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (method !== "POST") return json(405, { ok: false, reason: "method-not-allowed" });

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, reason: "bad-json" }); }

  const intake = buildIntake({ url: input.url, goal: input.goal });
  if (!intake.ok) return json(400, { ok: false, reason: intake.reason });
  if (input.authorized !== true) return json(403, { ok: false, reason: "not-authorized" });

  // Honest failure (ADR-0030): if Blobs isn't configured on this site, say so with our
  // JSON contract — never crash into a raw 500 that the client mistakes for "unreachable"
  // and silently degrades to the AI-less in-browser path.
  let store;
  try {
    store = await createBlobStore();
    if (!(await store.healthy())) return json(503, { ok: false, reason: "storage-unconfigured" });
  } catch (e) {
    return json(503, { ok: false, reason: "storage-unconfigured", detail: String((e && e.name) || e) });
  }

  // Trigger the background function (returns 202 fast; it runs up to 15 min).
  const base = process.env.DEPLOY_PRIME_URL || process.env.URL || (event.headers && ("https://" + event.headers.host)) || "";
  const trigger = async (id, url) => {
    await fetch(base + "/.netlify/functions/generate-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, url, goal: intake.request.goal || null }),
    });
  };

  const r = await submitJob({ url: intake.request.url, regenerate: input.regenerate === true, store, trigger });
  if (!r.ok) return json(400, r);
  return json(200, r);
};

export default handler;
