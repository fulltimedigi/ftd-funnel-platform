/**
 * netlify/functions/generate.mjs — RETIRED (ADR-0032).
 * ---------------------------------------------------------------------------
 * This was the SYNC generator. Heavy Opus authoring exceeds Netlify's ~26s sync
 * limit, so it 504'd AFTER spending the API key — the worst outcome. Generation
 * moved to the async submit → background → poll flow (ADR-0029). This endpoint now
 * returns 501 and never calls the model. Kept as a signpost so any stale caller
 * gets an honest redirect to the live flow instead of a timeout.
 */

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export const handler = async (event = {}) => {
  if (event && event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  return {
    statusCode: 501,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
    body: JSON.stringify({
      ok: false,
      reason: "endpoint-retired",
      use: { submit: "/.netlify/functions/generate-submit", status: "/.netlify/functions/generate-status" },
      note: "Synchronous generation was retired (ADR-0032). Use the async submit → poll flow.",
    }),
  };
};

export default handler;
