/**
 * analytics/auditQueue.js — shared localStorage audit trail for lead sinks.
 * ---------------------------------------------------------------------------
 * Every submitted lead is appended to a bounded localStorage ring buffer so a lead
 * is never lost even when the network confirmation is impossible. The webhook sink
 * already capped at 50; the Sheets sink grew unbounded — this shared helper caps both
 * consistently (ADR-0032 Group 3). Never throws (localStorage may be unavailable).
 */

export function appendAudit(key, payload, cap = 50) {
  try {
    const prev = JSON.parse(globalThis.localStorage?.getItem(key) || "[]");
    prev.push(payload);
    globalThis.localStorage?.setItem(key, JSON.stringify(prev.slice(-cap)));
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}
