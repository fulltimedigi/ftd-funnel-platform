/**
 * engine/flow.js — Step sequencing.
 *
 * Responsibility (SPEC §5):
 *   Decide the next/previous step. Branching is supported via the chosen
 *   option's `next` field; if absent, advance to the next question in the array.
 *   (Phase-1 funnels are linear, but the branching path is honored here.)
 */

export function firstStepId(config) {
  return config.questions?.[0]?.id ?? null;
}

export function getQuestion(config, id) {
  return (config.questions || []).find((q) => q.id === id) || null;
}

export function getOption(question, optionId) {
  return (question?.options || []).find((o) => o.id === optionId) || null;
}

/** Next step id given the current question and the chosen option (or null = end). */
export function nextStepId(config, currentId, chosenOption) {
  if (chosenOption?.next) return chosenOption.next;
  const qs = config.questions || [];
  const i = qs.findIndex((q) => q.id === currentId);
  if (i < 0) return null;
  return qs[i + 1]?.id ?? null;
}

/** 1-based position of a question in the linear array (for progress display). */
export function questionNumber(config, id) {
  const i = (config.questions || []).findIndex((q) => q.id === id);
  return i < 0 ? 0 : i + 1;
}

export function totalQuestions(config) {
  return (config.questions || []).length;
}

/**
 * Respondent-experienced steps (UX_INTERFACE_DECISION: "3–5 steps"). A "step" is
 * a screen with the progress bar: the question screens PLUS the email-capture
 * screen that precedes the result (email is captured before the reveal). The
 * result screen is the payoff, not a counted step. This is the honest way to meet
 * the 3–5 target without ever padding unjustified questions (anti-bland wins).
 */
export function respondentStepCount(config) {
  const q = totalQuestions(config);
  const gated = config.leadForm && config.leadForm.gated !== false && (config.leadForm.fields || []).length > 0;
  return q + (gated ? 1 : 0);
}
