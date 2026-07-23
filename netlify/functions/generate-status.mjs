/**
 * netlify/functions/generate-status.mjs — poll an async generation job (ADR-0029).
 * GET ?id=<key> → the Blobs record: {status:"pending"|"ready"|"error"|"unknown"}
 * (ready carries config + gates + ai diagnostic). Fast, lightweight.
 */

import { statusJob } from "../../platform/jobs/generateJob.js";
import { createBlobStore } from "../../platform/jobs/blobStore.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }, body: JSON.stringify(body) });

export const handler = async (event = {}) => {
  const method = event.httpMethod;
  if (method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (method !== "GET") return json(405, { status: "error", reason: "method-not-allowed" });

  const id = (event.queryStringParameters && event.queryStringParameters.id) || "";
  if (!id) return json(400, { status: "error", reason: "missing-id" });

  const store = await createBlobStore();
  const rec = await statusJob({ id, store });
  // Add the live key-present diagnostic (never the key itself) for debuggability.
  if (rec && rec.ai) rec.ai = { keyPresent: !!process.env.ANTHROPIC_API_KEY, ...rec.ai };
  return json(200, rec);
};

export default handler;
