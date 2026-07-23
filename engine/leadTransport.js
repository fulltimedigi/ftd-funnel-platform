/**
 * engine/leadTransport.js — Configurable, multi-destination lead transport (ADR-0020).
 * ---------------------------------------------------------------------------
 * Fans a lead out to EVERY configured destination (Google Sheets and/or a
 * universal Webhook) and returns one honest result: ok if at least one
 * destination accepted it, with per-sink results attached. With no destination
 * configured it reports `no-endpoint` (honest — the funnel stays on the form).
 *
 * Sits under the offline outbox (ADR-0006), so a lead is still retried if every
 * destination fails. Pure/Node-safe (sinks use injected `fetch`).
 */

import { createSheetsSink } from "../analytics/sheets-sink.js";
import { createWebhookSink, isUsableWebhook } from "../analytics/webhook-sink.js";

function _usableSheets(url) {
  return typeof url === "string" && url.length > 0 && !url.startsWith("PASTE_");
}

/**
 * @param {{sheetsEndpoint?:string, webhookUrl?:string}} cfg
 * @returns {{ sinkCount:number, kinds:string[], submit:(payload)=>Promise<{ok:boolean, results:Array}> }}
 */
export function createLeadTransport(cfg = {}) {
  const sinks = [];
  if (_usableSheets(cfg.sheetsEndpoint)) sinks.push({ kind: "sheets", sink: createSheetsSink(cfg.sheetsEndpoint) });
  if (isUsableWebhook(cfg.webhookUrl)) sinks.push({ kind: "webhook", sink: createWebhookSink(cfg.webhookUrl) });

  return {
    sinkCount: sinks.length,
    kinds: sinks.map((s) => s.kind),
    async submit(payload) {
      if (!sinks.length) return { ok: false, reason: "no-endpoint", results: [] };
      const results = await Promise.all(
        sinks.map((s) =>
          Promise.resolve()
            .then(() => s.sink.submit(payload))
            .then((r) => ({ kind: s.kind, ...(r || { ok: false }) }))
            .catch((e) => ({ kind: s.kind, ok: false, reason: "threw", error: String(e && e.message || e) }))
        )
      );
      return { ok: results.some((r) => r && r.ok), results };
    },
  };
}
