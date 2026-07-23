/**
 * authoring/index.js — End-to-end authoring: brand URL → funnel config.
 * ---------------------------------------------------------------------------
 * Stage 1 + Stage 2 composed: ingest the real catalog (compliance-gated), then
 * author a trust-gate-passing funnel from it. Honest failure at each stage; never
 * fabricates. The fetcher is injectable, so the whole chain runs offline in tests.
 */

import { ingestCatalog } from "./ingest/index.js";
import { authorFunnel } from "./author/index.js";
import { trustValidate } from "../engine/trustValidate.js";
import { antiBlandCheck } from "./author/qualityGate.js";

/**
 * @param {string} url - the client's own brand URL (authorized)
 * @param {Object} opts - passed through to ingest (authorized, fetch, …) and author (brandName, …)
 * @returns {Promise<{ok:boolean, stage?:string, reason?:string, config?:Object,
 *   catalog?:Object, trust?:Object, meta?:Object, notes?:string[]}>}
 */
export async function generateFunnelFromUrl(url, opts = {}) {
  const ing = await ingestCatalog(url, opts);
  if (!ing.ok) return { ok: false, stage: "ingest", reason: ing.reason, notes: ing.notes };
  if (!ing.products.length) {
    return { ok: false, stage: "ingest", reason: "empty-catalog", report: ing.report, notes: ing.notes };
  }

  const authored = authorFunnel({ products: ing.products, origin: ing.origin, brandUrl: ing.brandUrl }, opts);
  if (!authored.ok) {
    return { ok: false, stage: "author", reason: authored.reason, meta: authored.meta,
      catalog: { origin: ing.origin, products: ing.products, report: ing.report }, notes: ing.notes };
  }

  const trust = trustValidate(authored.config);
  const bland = antiBlandCheck(authored.config);
  return {
    ok: true,
    config: authored.config,
    catalog: { origin: ing.origin, products: ing.products, report: ing.report },
    trust,               // { ok, findings } — the caller can gate on trust.ok
    bland,               // { ok, findings } — anti-bland gate (ADR-0016)
    meta: authored.meta,
    notes: ing.notes,
  };
}
