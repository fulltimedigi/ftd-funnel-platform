/**
 * authoring/index.js — End-to-end authoring: brand URL → funnel config.
 * ---------------------------------------------------------------------------
 * Stage 1 + Stage 2 composed, now with the moat (ADR-0028): ingest the real
 * catalog, extract the brand's logo + palette (Track B), author a funnel, and —
 * when the catalog JUSTIFIES more than the deterministic miner found (the
 * richness gate, Track A) — escalate to grounded AI enrichment (Track C, an
 * INJECTED `opts.enrich` so this stays offline-testable).
 *
 * Honest at every step: the AI path is validated by trust + anti-bland + richness
 * and only accepted if it beats the deterministic draft; otherwise we keep the
 * deterministic draft (thin but honest) — never fabricated richness.
 */

import { ingestCatalog } from "./ingest/index.js";
import { authorFunnel } from "./author/index.js";
import { trustValidate } from "../engine/trustValidate.js";
import { antiBlandCheck } from "./author/qualityGate.js";
import { richnessCheck } from "./quality/richnessCheck.js";
import { extractBrand, brandToThemeVars } from "./brand/extractBrand.js";

/**
 * @param {string} url - the client's own brand URL (authorized)
 * @param {Object} opts - ingest/author options + optional `goal` and
 *   `enrich(catalog, {goal, brand}) => Promise<{ok, config, meta?}>` (Track C).
 */
export async function generateFunnelFromUrl(url, opts = {}) {
  const ing = await ingestCatalog(url, opts);
  if (!ing.ok) return { ok: false, stage: "ingest", reason: ing.reason, notes: ing.notes };
  if (!ing.products.length) {
    return { ok: false, stage: "ingest", reason: "empty-catalog", report: ing.report, notes: ing.notes };
  }

  const catalog = { origin: ing.origin, products: ing.products, report: ing.report, brandUrl: ing.brandUrl };
  const brand = extractBrand(ing.startHtml || "", ing.origin);
  const themeVars = brandToThemeVars(brand);

  // 1) Deterministic author (fast, free, honest — the baseline / fallback).
  const authored = authorFunnel({ products: ing.products, origin: ing.origin, brandUrl: ing.brandUrl }, opts);
  let config = authored.ok ? authored.config : null;
  let source = authored.ok ? "deterministic" : null;
  let meta = (authored && authored.meta) || null;
  let richness = config ? richnessCheck(config, catalog) : { ok: false, findings: [{ code: "NO_CONFIG" }], metrics: { questions: 0 } };

  // 2) Escalate to AI enrichment when the deterministic draft is missing or too
  //    thin for a catalog this rich, and an enricher is available. The enricher
  //    returns an already gate-passing config; accept it only if it's better.
  let ai = { attempted: false }; // live diagnostic (no secrets) — why AI ran or didn't
  if ((!config || !richness.ok) && typeof opts.enrich === "function") {
    ai = { attempted: true };
    try {
      const en = await opts.enrich(catalog, { goal: opts.goal, brand });
      ai.enrichOk = !!(en && en.ok);
      if (en && !en.ok) { ai.reason = en.reason; if (en.error) ai.error = en.error; }
      if (en && en.ok && en.config) {
        const enRich = richnessCheck(en.config, catalog);
        const betterDepth = (enRich.metrics.questions || 0) > (richness.metrics.questions || 0);
        if (!config || enRich.ok || betterDepth) {
          config = en.config; source = "ai"; meta = en.meta || meta; richness = enRich; ai.accepted = true;
        } else { ai.accepted = false; ai.reason = "not-deeper-than-deterministic"; }
      }
    } catch (e) { ai.reason = "threw"; ai.error = String((e && e.message) || e); /* honest fallback */ }
  }

  if (!config) {
    return {
      ok: false, stage: "author", reason: (authored && authored.reason) || "author-failed",
      meta: authored && authored.meta, catalog, notes: ing.notes,
    };
  }

  // 3) Attach brand auto-styling (Track B) to the chosen config.
  config = { ...config, themeVars };
  if (brand.logo && config.brand) config = { ...config, brand: { ...config.brand, logo: brand.logo } };

  const trust = trustValidate(config);
  const bland = antiBlandCheck(config);
  return {
    ok: true,
    config,
    source,                // "deterministic" | "ai" — how this funnel was authored
    catalog,
    brand,                 // { logo, colors }
    trust,                 // { ok, findings }
    bland,                 // { ok, findings } — anti-bland gate (ADR-0016)
    richness,              // { ok, findings, metrics } — the "too thin" gate (ADR-0028)
    ai,                    // { attempted, enrichOk, accepted, reason?, error? } — live AI diagnostic
    meta,
    notes: ing.notes,
  };
}
