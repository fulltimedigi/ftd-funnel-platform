/**
 * netlify/functions/generate.mjs — Server-side funnel generator (ADR-0027, Stage 3C-1).
 * ---------------------------------------------------------------------------
 * Runs the REAL, deterministic pipeline (ingest → author → trust + anti-bland)
 * on a Netlify Function. A Node server has no CORS restriction on outbound
 * fetches, so this reads a real client site that the browser could not — the
 * whole unlock of Stage 3C.
 *
 * Thin adapter over the already-green pipeline: parse → validate (same pure
 * buildIntake as the screen) → enforce the authorized-sites-only scope → run →
 * shape an honest response. Never fabricates; a pipeline failure is a real 422,
 * not a fake success (rule 4).
 */

import { generateFunnelFromUrl } from "../../authoring/index.js";
import { buildIntake } from "../../platform/intake/intakeModel.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }, body: JSON.stringify(body) };
}

export const handler = async (event = {}) => {
  const method = event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method);
  if (method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (method !== "POST") return json(405, { ok: false, reason: "method-not-allowed" });

  let input;
  try { input = JSON.parse(event.body || "{}"); }
  catch { return json(400, { ok: false, reason: "bad-json" }); }

  const intake = buildIntake({ url: input.url, goal: input.goal });
  if (!intake.ok) return json(400, { ok: false, reason: intake.reason });

  // Authorized/own-client sites only (ADR-0013). 3C-2 binds this to the tenant's
  // verified domains; here it is an explicit caller confirmation.
  if (input.authorized !== true) return json(403, { ok: false, reason: "not-authorized" });

  let res;
  try {
    res = await generateFunnelFromUrl(intake.request.url, {
      authorized: true,
      goal: intake.request.goal || undefined,
    });
  } catch (err) {
    return json(500, { ok: false, reason: "server-error", error: String((err && err.message) || err) });
  }

  if (!res || !res.ok) {
    return json(422, { ok: false, stage: res && res.stage, reason: (res && res.reason) || "generation-failed", notes: res && res.notes });
  }

  // Shape an honest, compact success — config + both gate results + a catalog
  // summary (not the full product list). The client stashes config and reports
  // the real product count.
  return json(200, {
    ok: true,
    config: res.config,
    trust: res.trust,
    bland: res.bland,
    catalog: { origin: res.catalog && res.catalog.origin, count: (res.catalog && res.catalog.products && res.catalog.products.length) || 0 },
  });
};

export default handler;
