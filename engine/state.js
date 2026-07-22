/**
 * engine/state.js — Single source of truth.
 *
 * Responsibility (SPEC §5):
 *   Hold currentStepId, answers{questionId:optionId}, history[]. Persist to and
 *   restore from localStorage, namespaced by config id, so a refresh never wipes
 *   progress. (All four demos lacked this.)
 *
 * localStorage is accessed defensively (try/catch) so the engine still runs in
 * environments without it.
 */

const LS_PREFIX = "ftd:";

export function createState(configId) {
  return { configId, currentStepId: null, answers: {}, history: [] };
}

export function setAnswer(state, questionId, optionId) {
  state.answers[questionId] = optionId;
}

export function getAnswer(state, questionId) {
  return state.answers[questionId];
}

export function reset(state) {
  state.currentStepId = null;
  state.answers = {};
  state.history = [];
  save(state);
}

export function save(state) {
  try {
    globalThis.localStorage?.setItem(
      LS_PREFIX + state.configId,
      JSON.stringify({
        currentStepId: state.currentStepId,
        answers: state.answers,
        history: state.history,
      })
    );
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

export function restore(state) {
  try {
    const raw = globalThis.localStorage?.getItem(LS_PREFIX + state.configId);
    if (!raw) return false;
    const data = JSON.parse(raw);
    state.currentStepId = data.currentStepId ?? null;
    state.answers = data.answers || {};
    state.history = data.history || [];
    return true;
  } catch {
    return false;
  }
}
