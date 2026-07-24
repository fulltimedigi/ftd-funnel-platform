/**
 * netlify/functions/generate-status.mjs — poll an async generation job (ADR-0029/0032).
 * GET ?id=<key> → the Blobs record: {status:"pending"|"ready"|"error"|"unknown"}
 * (ready carries config + gates + ai diagnostic). Job ids are salted (unguessable), so a
 * result can't be read by guessing the URL. Tightened CORS + optional token gate.
 */

import { statusJob } from "../../platform/jobs/generateJob.js";
import { createBlobStore } from "../../platform/jobs/blobStore.js";
import { makeHttp, tokenOk } from "./lib/http.mjs";

const { json, preflight } = makeHttp("GET, OPTIONS");

export const handler = async (event = {}) => {
  const method = event.httpMethod;
  if (method === "OPTIONS") return preflight(event);
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
