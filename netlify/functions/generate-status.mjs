/**
 * netlify/functions/generate-status.mjs — poll an async generation job (ADR-0029/0032).
 * GET ?id=<key> → the Blobs record: {status:"pending"|"ready"|"error"|"unknown"}
 * (ready carries config + gates + ai diagnostic). Job ids are salted (unguessable), so a
 * result can't be read by guessing the URL. Tightened CORS + optional token gate.
 */

import { statusJob } from "../../platform/jobs/generateJob.js";
import { createBlobStore } from "../../platform/jobs/blobStore.js";

const ALLOWED_ORIGINS = (process.env.FTD_ALLOWED_ORIGINS || "https://ftd-studio-preview.netlify.app,https://fulltimedigi.com,https://www.fulltimedigi.com").split(",").map((s) => s.trim()).filter(Boolean);

function cors(event) {
  const o = event.headers && (event.headers.origin || event.headers.Origin);
  const allow = o && ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0];
  return { "Access-Control-Allow-Origin": allow, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, x-ftd-token" };
}
const json = (event, statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(event) }, body: JSON.stringify(body) });

function tokenOk(event) {
  const need = process.env.FTD_PUBLIC_TOKEN;
  if (!need) return true;
  const got = event.headers && (event.headers["x-ftd-token"] || event.headers["X-Ftd-Token"]);
  return got === need;
}

export const handler = async (event = {}) => {
  const method = event.httpMethod;
  if (method === "OPTIONS") return { statusCode: 204, headers: cors(event), body: "" };
  if (method !== "GET") return json(event, 405, { status: "error", reason: "method-not-allowed" });
  if (!tokenOk(event)) return json(event, 401, { status: "error", reason: "unauthorized" });

  const id = (event.queryStringParameters && event.queryStringParameters.id) || "";
  if (!id) return json(event, 400, { status: "error", reason: "missing-id" });

  const store = await createBlobStore();
  const rec = await statusJob({ id, store });
  // Add the live key-present diagnostic (never the key itself) for debuggability.
  if (rec && rec.ai) rec.ai = { keyPresent: !!process.env.ANTHROPIC_API_KEY, ...rec.ai };
  return json(event, 200, rec);
};

export default handler;
