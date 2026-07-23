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
import { enrichAuthor } from "../../authoring/ai/enrichAuthor.js";
import { createAnthropicComplete } from "../../authoring/ai/complete.js";

// Grounded AI enrichment (ADR-0028) — only when an API key is configured on the
// site (a server secret). Without it, generation falls back to the deterministic
// author, honestly. The design step runs server-side with claude-sonnet-5.
function buildEnricher() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return undefined;
  const complete = createAnthropicComplete({ apiKey: key });
  return (catalog, ctx) => enrichAuthor(catalog, { ...ctx, complete });
}

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
      enrich: buildEnricher(),
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
    source: res.source,       // "deterministic" | "ai" (ADR-0028)
    trust: res.trust,
    bland: res.bland,
    richness: res.richness,    // the "too thin" gate report
    ai: { keyPresent: !!process.env.ANTHROPIC_API_KEY, ...(res.ai || {}) }, // live diagnostic (never the key itself)
    catalog: { origin: res.catalog && res.catalog.origin, count: (res.catalog && res.catalog.products && res.catalog.products.length) || 0 },
  });
};

export default handler;
