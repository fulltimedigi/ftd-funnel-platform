/**
 * engine/analytics.js — Event bus + sink registration (ADR-0007).
 * ---------------------------------------------------------------------------
 * A tiny event bus emitting a FIXED vocabulary to pluggable sinks. Analytics
 * must exist from day one — without it we can't prove ROI, and ROI is the sale.
 *
 * Ported from the production engine (replacing v0's throwing stub). All modules
 * emit events here; sinks (Sheets, GA4) register and receive every event.
 *
 * RULE: Analytics must never throw or block the funnel. A sink failure is
 *   caught silently (analytics failure ≠ funnel failure).
 *
 * Event vocabulary (docs/EVENTS.md):
 *   quiz_start, question_answered, question_back, lead_shown, lead_submitted,
 *   lead_skipped, result_shown, cta_clicked, funnel_complete, restart.
 */

/** @type {Array<function>} Registered sink functions */
const _sinks = [];

/** @type {string} Current funnel id */
let _funnelId = "";

/**
 * Initialize the analytics bus for a funnel.
 * @param {string} funnelId
 */
export function initAnalytics(funnelId) {
  _funnelId = funnelId || "";
}

/**
 * Reset the bus (drop all sinks + funnel id). Primarily for tests and for a
 * clean re-init; harmless in production (one funnel per page).
 */
export function resetAnalytics() {
  _sinks.length = 0;
  _funnelId = "";
}

/**
 * Register a sink — any function(event) that handles an event. Sinks should be
 * idempotent and never throw.
 * @param {function} sinkFn
 */
export function registerSink(sinkFn) {
  if (typeof sinkFn === "function") _sinks.push(sinkFn);
}

/**
 * Emit an analytics event to all registered sinks. Fire-and-forget; never
 * blocks or throws.
 * @param {string} eventName - one of the fixed vocabulary events
 * @param {Object} [payload={}]
 */
export function emit(eventName, payload = {}) {
  const event = {
    event: eventName,
    funnelId: _funnelId,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  for (const sink of _sinks) {
    try {
      const result = sink(event);
      // If a sink returns a Promise, swallow rejections — never surface to the funnel.
      if (result && typeof result.catch === "function") {
        result.catch((err) => console.warn(`[analytics] sink error for "${eventName}":`, err?.message));
      }
    } catch (err) {
      console.warn(`[analytics] sink threw for "${eventName}":`, err?.message);
    }
  }
}

// ─── Typed event emitters (enforce the payload contract) ──────────────────────

/** User starts the funnel (first question shown). */
export function emitQuizStart(theme) {
  emit("quiz_start", { theme });
}

/** User answers a question. stepIndex is 1-based. */
export function emitQuestionAnswered(questionId, optionId, stepIndex) {
  emit("question_answered", { questionId, optionId, stepIndex });
}

/** User navigates back. */
export function emitQuestionBack(fromStep, toStep) {
  emit("question_back", { fromStep, toStep });
}

/** Lead form is shown. */
export function emitLeadShown() {
  emit("lead_shown", {});
}

/** Lead submit attempted — success is the resolved outcome. */
export function emitLeadSubmitted(success) {
  emit("lead_submitted", { success: !!success });
}

/** User skips the lead form. */
export function emitLeadSkipped() {
  emit("lead_skipped", {});
}

/** Result page rendered. */
export function emitResultShown(primaryArchetype, secondaryArchetype, flags) {
  emit("result_shown", { primaryArchetype, secondaryArchetype, flags });
}

/** User clicks a CTA. */
export function emitCtaClicked(ctaTarget, archetype, ctaType = "primary") {
  emit("cta_clicked", { ctaTarget, archetype, ctaType });
}

/** Result fully reached (end of funnel). */
export function emitFunnelComplete(archetype, leadCaptured) {
  emit("funnel_complete", { archetype, leadCaptured: !!leadCaptured });
}

/** User restarts the funnel. */
export function emitRestart() {
  emit("restart", {});
}
