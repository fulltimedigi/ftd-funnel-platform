/**
 * analytics/ga4-sink.js — Forward analytics events to Google Analytics 4 (ADR-0007).
 * ---------------------------------------------------------------------------------
 * Optional. Only active if config.analytics.ga4Id is set and the GA4 script has
 * loaded `window.gtag`. Registers itself onto the engine analytics bus.
 *
 * Ported from the production engine (replacing v0's throwing stub). Host-safe:
 * with no `window.gtag` (Node, or GA4 not yet loaded) it skips silently and
 * never throws — analytics failure ≠ funnel failure.
 *
 * HTML shell must include:
 *   <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
 *   <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
 *           gtag('js', new Date()); gtag('config', 'G-XXXX');</script>
 * (Note: the GA4 domain must be allowed by the page CSP — see ADR-0003 bug list.)
 */

import { registerSink as _registerAnalyticsSink } from "../engine/analytics.js";

/**
 * Register the GA4 analytics sink.
 * @param {string} measurementId - GA4 Measurement ID (G-XXXXXXX)
 */
export function registerSink(measurementId) {
  if (!measurementId) {
    console.warn("[ga4-sink] No measurementId — GA4 analytics disabled.");
    return;
  }
  _registerAnalyticsSink((event) => _sendToGA4(event, measurementId));
}

function _sendToGA4(event, measurementId) {
  // gtag not present (Node, or GA4 not loaded yet) — skip silently.
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;

  const eventName = _sanitizeEventName(event.event);
  const params = _buildGA4Params(event, measurementId);

  try {
    window.gtag("event", eventName, params);
  } catch {
    /* silent — analytics never throws */
  }
}

/**
 * Map a funnel event to GA4 params. GA4 constraints: names/params ≤ 40 chars,
 * lowercase, underscores only.
 */
function _buildGA4Params(event, measurementId) {
  const params = {
    funnel_id: _truncate(event.funnelId, 40),
    send_to: measurementId,
  };

  switch (event.event) {
    case "quiz_start":
      params.engagement_type = "quiz_start";
      params.theme = _truncate(event.theme, 40);
      break;
    case "question_answered":
      params.question_id = _truncate(event.questionId, 40);
      params.option_id = _truncate(event.optionId, 40);
      params.step_index = event.stepIndex;
      break;
    case "question_back":
      params.from_step = _truncate(event.fromStep, 40);
      params.to_step = _truncate(event.toStep, 40);
      break;
    case "lead_submitted":
      params.success = event.success ? 1 : 0;
      break;
    case "lead_skipped":
      params.engagement_type = "skip_lead";
      break;
    case "result_shown":
      params.archetype = _truncate(event.primaryArchetype, 40);
      params.secondary_archetype = _truncate(event.secondaryArchetype, 40);
      break;
    case "cta_clicked":
      params.link_url = _truncate(event.ctaTarget, 100);
      params.archetype = _truncate(event.archetype, 40);
      params.cta_type = event.ctaType;
      break;
    case "funnel_complete":
      params.archetype = _truncate(event.archetype, 40);
      params.lead_captured = event.leadCaptured ? 1 : 0;
      break;
    case "restart":
      params.engagement_type = "restart";
      break;
  }
  return params;
}

/** Sanitize event name for GA4 (lowercase, underscores, ≤ 40 chars). */
function _sanitizeEventName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 40);
}

function _truncate(str, maxLen) {
  if (!str) return "";
  return String(str).slice(0, maxLen);
}
