/**
 * engine/analytics.js — Event bus.
 *
 * Responsibility (§5, §11):
 *   A tiny event bus emitting a FIXED vocabulary to pluggable sinks. Analytics
 *   must exist from day one — without it we can't prove ROI, and ROI is the sale.
 *
 * Event vocabulary (see docs/EVENTS.md):
 *   quiz_start, question_answered, question_back, lead_shown, lead_submitted,
 *   lead_skipped, result_shown, cta_clicked, funnel_complete, restart.
 *
 * Sinks (v0.1): analytics/sheets-sink.js (default), analytics/ga4-sink.js (opt).
 *
 * Exposes (planned): registerSink(fn), emit(event, payload).
 *
 * STATUS: foundation stub. No logic implemented yet.
 */

// TODO(v0.1): implement bus + sink registration.
export function emit() {
  throw new Error("engine/analytics.js: not implemented (foundation stub)");
}
export function registerSink() {
  throw new Error("engine/analytics.js: not implemented (foundation stub)");
}
