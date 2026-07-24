/**
 * analytics/sheets-sink.js — Google Sheets transport (SPEC §10, §12).
 *
 * Phase: lead loop only. Posts a lead payload to the Apps Script /exec endpoint
 * so it lands in the Google Sheet. (Analytics-event forwarding comes later.)
 *
 * CORS reality (documented, per SPEC §10): Apps Script web apps don't return
 * CORS headers, so the browser can't read the response. We POST as a "simple
 * request" (text/plain → no preflight) in `no-cors` mode: a resolved fetch means
 * the request was SENT (row written), a thrown fetch means a real network
 * failure. We therefore report { ok:true, confirmed:false } on send — we cannot
 * read the server's confirmation, so we never claim more than "sent".
 *
 * Safety net: every submitted lead is also appended to a localStorage audit
 * queue, so a lead is never lost even when confirmation is impossible.
 *
 * createSheetsSink(endpoint) → { endpoint, submit(payload) -> Promise<result> }
 *   result: { ok:boolean, confirmed?:boolean, reason?:string, error?:string }
 *
 * This file has TWO roles that share the same /exec endpoint but never collide:
 *   - createSheetsSink(endpoint).submit(payload) — the LEAD transport (lead loop).
 *   - registerSink(endpoint) — the analytics EVENT sink (ADR-0007): registers
 *     itself on the engine bus and forwards each event to the Sheet's Events tab.
 */

import { registerSink as _registerAnalyticsSink } from "../engine/analytics.js";
import { appendAudit } from "./auditQueue.js";

function isUsableEndpoint(endpoint) {
  return typeof endpoint === "string" && endpoint.length > 0 && !endpoint.startsWith("PASTE_");
}

export function createSheetsSink(endpoint) {
  return {
    endpoint,
    async submit(payload) {
      if (!isUsableEndpoint(endpoint)) {
        return { ok: false, reason: "no-endpoint" };
      }

      // Audit trail first — don't lose the lead even if the network fails. Bounded to
      // the last 50 (matches the webhook sink) so the buffer can't grow unbounded.
      appendAudit("ftd:leads:" + (payload.funnelId || "default"), payload, 50);

      try {
        await fetch(endpoint, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload),
        });
        // Opaque response under no-cors: request was sent, can't read result.
        return { ok: true, confirmed: false };
      } catch (err) {
        return { ok: false, reason: "network", error: String(err) };
      }
    },
  };
}

// ─── Analytics event sink ─────────────────────────────────────────────────────

/**
 * Register the Sheets analytics-EVENT sink on the engine bus. Each emitted event
 * is POSTed (best-effort, no-cors) to the same /exec endpoint, landing in the
 * Events tab. Fire-and-forget with silent catch — analytics never blocks or
 * throws. Distinct from createSheetsSink().submit, which sends leads.
 * @param {string} endpoint - Apps Script /exec URL
 */
export function registerSink(endpoint) {
  if (!isUsableEndpoint(endpoint)) {
    console.warn("[sheets-sink] No usable endpoint — Sheets analytics disabled.");
    return;
  }
  _registerAnalyticsSink((event) => _sendEvent(endpoint, event));
}

async function _sendEvent(endpoint, event) {
  if (typeof fetch !== "function") return; // host without fetch — can't send
  const body = {
    type: "event",
    event: event.event,
    funnelId: event.funnelId,
    timestamp: event.timestamp,
    payload: JSON.stringify(_eventData(event)),
  };
  try {
    await fetch(endpoint, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
  } catch {
    /* silent — analytics never throws */
  }
}

/** Event-specific fields only (top-level funnelId/timestamp are already sent). */
function _eventData(event) {
  const cleaned = { ...event };
  delete cleaned.funnelId;
  delete cleaned.timestamp;
  return cleaned;
}
