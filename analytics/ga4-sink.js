/**
 * analytics/ga4-sink.js — GA4 analytics sink (optional).
 *
 * Responsibility (SPEC §11):
 *   Forward analytics events to GA4 via gtag, only if config.analytics.ga4Id set.
 *
 * Exposes (planned): createGa4Sink(ga4Id) → (event, payload) => void.
 *
 * STATUS: foundation stub. No logic implemented yet.
 */

// TODO(v0.1): implement gtag forwarding.
export function createGa4Sink() {
  throw new Error("analytics/ga4-sink.js: not implemented (foundation stub)");
}
